// mcp-bridge.ts — Bridges MCP servers into cave's tool surface.
//
// Responsibilities:
//   1. Build an `AgentTool` for the always-on `mcp_tool_search` (Anthropic
//      ToolSearch pattern). Always lives in the prompt — costs ~120 tokens.
//   2. Optionally expose specific MCP tools as full AgentTools when
//      `deferSchemas` is false (legacy mode).
//   3. Convert MCP `content` results into cave's TextContent/ImageContent.
//
// Wire-up: `cave` constructs an `McpHub`, calls `loadConfig()`, then asks the
// bridge for tools to register on the agent. The bridge owns all lifecycle.

import { type AgentTool, mcp as agentMcp } from "@caveman-code/agent";
import { Type } from "@sinclair/typebox";

type McpHub = agentMcp.McpHub;
type McpRemoteTool = agentMcp.McpRemoteTool;
type McpServerConfig = agentMcp.McpServerConfig;
type McpSettings = agentMcp.McpSettings;

const TOOL_SEARCH_NAME = "mcp_tool_search";
const TOOL_CALL_NAME = "mcp_tool_call";

interface McpContentItem {
	type?: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

function normalizeMcpResult(raw: unknown): {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	details: { rawContent: unknown };
} {
	// MCP "tools/call" result shape: { content: [{ type, text|data, mimeType? }], ... }
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	if (raw && typeof raw === "object") {
		const items = (raw as { content?: McpContentItem[] }).content;
		if (Array.isArray(items)) {
			for (const item of items) {
				if (!item || typeof item !== "object") continue;
				if (item.type === "text" && typeof item.text === "string") {
					content.push({ type: "text", text: item.text });
				} else if ((item.type === "image" || item.type === "audio") && typeof item.data === "string") {
					content.push({
						type: "image",
						data: item.data,
						mimeType: item.mimeType ?? "application/octet-stream",
					});
				} else if (typeof item.text === "string") {
					content.push({ type: "text", text: item.text });
				}
			}
		}
	}
	if (content.length === 0) {
		// Always include something for the model to read.
		content.push({ type: "text", text: JSON.stringify(raw, null, 2) });
	}
	return { content, details: { rawContent: raw } };
}

const toolSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Substring matched against tool name + description." })),
	server: Type.Optional(Type.String({ description: "Restrict to a single MCP server name." })),
	limit: Type.Optional(Type.Number({ description: "Max results (default 20, max 50)." })),
});

const toolCallSchema = Type.Object({
	name: Type.String({ description: "Namespaced tool name (mcp__<server>__<tool>)." }),
	arguments: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arguments object matching the tool's input schema.",
		}),
	),
});

/**
 * Build the always-on MCP tool slice. Two tools, ~250 tokens combined:
 *   - `mcp_tool_search` — find a tool by name/description; returns full schemas.
 *   - `mcp_tool_call`   — invoke any namespaced tool the model has discovered.
 *
 * Once the model has the schema for a specific tool it wants to call often,
 * agent runners may promote the namespaced tool to its own AgentTool via
 * `buildNamespacedTool()` below.
 */
export function buildAlwaysOnMcpTools(hub: McpHub): AgentTool<any>[] {
	const search: AgentTool<typeof toolSearchSchema> = {
		name: TOOL_SEARCH_NAME,
		label: "MCP Tool Search",
		description:
			"Search MCP tools across all configured servers. Returns name, server, description, " +
			"and JSON Schema for each match. Call this before mcp_tool_call when you need a tool's schema. " +
			"Tools live in the `mcp__<server>__<tool>` namespace.",
		parameters: toolSearchSchema,
		execute: async (_id, args) => {
			const inner = hub.buildToolSearchTool();
			const result = await inner.call(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: { kind: "mcp-tool-search", result },
			};
		},
	};

	const call: AgentTool<typeof toolCallSchema> = {
		name: TOOL_CALL_NAME,
		label: "MCP Tool Call",
		description:
			"Invoke a namespaced MCP tool. The `name` must be `mcp__<server>__<tool>` as returned by " +
			"mcp_tool_search. Arguments must match the tool's input schema.",
		parameters: toolCallSchema,
		execute: async (_id, args) => {
			const result = await hub.callNamespaced(args.name, args.arguments ?? {});
			return normalizeMcpResult(result);
		},
	};

	return [search, call];
}

/**
 * Build an AgentTool for a single namespaced MCP tool. Used when the agent
 * runner wants to expose a specific high-frequency tool directly without
 * forcing the model to go through ToolSearch every call.
 *
 * Schema validation is lenient — we accept whatever the server's JSON Schema
 * declared via a permissive Record, and let the server itself reject bad args.
 */
export function buildNamespacedTool(hub: McpHub, remote: McpRemoteTool): AgentTool<any> {
	const schema = Type.Record(Type.String(), Type.Unknown(), {
		description: remote.description,
	});
	return {
		name: remote.namespacedName,
		label: remote.title ?? remote.namespacedName,
		description:
			(remote.description ?? `MCP tool ${remote.name} on server ${remote.server}.`) + ` (server: ${remote.server})`,
		parameters: schema,
		execute: async (_id, args) => {
			const result = await hub.callNamespaced(remote.namespacedName, args);
			return normalizeMcpResult(result);
		},
	};
}

export interface McpBridgeOptions {
	settings?: McpSettings;
	/**
	 * If true (default): expose only the `mcp_tool_search` + `mcp_tool_call`
	 * pair — the always-on tool slice stays under ~250 tokens.
	 *
	 * If false: also pre-register every discovered tool as its own AgentTool,
	 * which inflates the system prompt but lets the model call tools
	 * directly without a ToolSearch round-trip.
	 */
	deferSchemas?: boolean;
}

/** Build the bridge tool list from a hub and its discovered tools. */
export async function buildBridgeTools(hub: McpHub, options: McpBridgeOptions = {}): Promise<AgentTool<any>[]> {
	const tools = buildAlwaysOnMcpTools(hub);
	const defer = options.deferSchemas ?? options.settings?.deferSchemas ?? true;
	if (defer) return tools;
	const remotes = await hub.listAllTools();
	for (const r of remotes) tools.push(buildNamespacedTool(hub, r));
	return tools;
}

/**
 * Construct an McpHub from a list of server configs (typically loaded by the
 * agent's discovery step). Connects all servers in parallel and returns the
 * hub plus any per-server errors so callers can surface diagnostics.
 */
export async function buildHubFromConfigs(
	servers: McpServerConfig[],
	settings?: McpSettings,
): Promise<{ hub: McpHub; errors: Array<{ name: string; error: string }> }> {
	const hub = new agentMcp.McpHub({ settings });
	for (const config of servers) hub.addServer(config);
	const results = await hub.connectAll();
	const errors = results.filter((r): r is { name: string; error: string } => Boolean(r.error));
	return { hub, errors };
}
