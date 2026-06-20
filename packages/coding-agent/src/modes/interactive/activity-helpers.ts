/**
 * Pure helpers for the interactive-mode activity monitor and `/login` parsing.
 *
 * Extracted verbatim from `interactive-mode.ts` (god-file decomposition #16,
 * stage 0). These are module-level pure functions with no dependency on the
 * `InteractiveMode` instance — behavior-preserving move, no logic changes.
 */

import type { ActivityKind } from "../../core/activity/activity-registry.js";

const SUBAGENT_TOOL_NAMES = new Set(["task", "agent"]);
const MCP_TOOL_NAMES = new Set(["mcp_tool_call", "mcp_tool_search"]);

/** Map a tool name to an activity kind (DD §11.3). MCP stays generic in v1 (B8). */
export function kindOf(toolName: string): ActivityKind {
	if (SUBAGENT_TOOL_NAMES.has(toolName)) return "subagent";
	if (MCP_TOOL_NAMES.has(toolName)) return "mcp";
	return "tool";
}

/** Human label for the row. Subagents show the agent name when derivable. */
export function labelOf(toolName: string, args: Record<string, unknown>): string {
	if (SUBAGENT_TOOL_NAMES.has(toolName)) {
		const agent = typeof args.agent === "string" ? args.agent : undefined;
		if (agent) return agent;
		if (Array.isArray(args.tasks) && args.tasks.length > 0) {
			const first = args.tasks[0] as { agent?: string } | undefined;
			if (first?.agent) return `${first.agent} +${args.tasks.length - 1}`;
		}
		if (Array.isArray(args.chain) && args.chain.length > 0) {
			const first = args.chain[0] as { agent?: string } | undefined;
			if (first?.agent) return `chain:${first.agent} +${args.chain.length - 1}`;
		}
		return "task";
	}
	if (toolName === "mcp_tool_call") return "mcp call";
	if (toolName === "mcp_tool_search") return "mcp search";
	return toolName;
}

/** Initial detail for a tool row (e.g. the bash command — the "which is slow" signal, B7). */
export function detailOf(toolName: string, args: Record<string, unknown>): string | undefined {
	if (toolName === "bash") {
		const cmd = typeof args.command === "string" ? args.command : undefined;
		return cmd ? truncateDetail(cmd) : undefined;
	}
	if (toolName === "mcp_tool_call") {
		const name = typeof args.name === "string" ? args.name : undefined;
		return name ? truncateDetail(name) : undefined;
	}
	if (toolName === "mcp_tool_search") {
		const query = typeof args.query === "string" ? args.query : undefined;
		return query ? truncateDetail(query) : undefined;
	}
	const path =
		typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
	return path ? truncateDetail(path) : undefined;
}

/** Best-effort detail derived from a streaming partial tool result. */
export function deriveDetail(partialResult: unknown): string | undefined {
	if (!partialResult || typeof partialResult !== "object") return undefined;
	const pr = partialResult as { content?: unknown };
	if (Array.isArray(pr.content)) {
		const firstText = pr.content.find(
			(c): c is { type: "text"; text: string } =>
				typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
		);
		if (firstText) {
			const line = firstText.text.split("\n").find((l) => l.trim().length > 0);
			if (line) return truncateDetail(line.trim());
		}
	}
	return undefined;
}

export function truncateDetail(s: string): string {
	const oneLine = s.replace(/\s+/g, " ").trim();
	return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
}

/** Resolve a user-typed provider name (id or alias) to a canonical id, or undefined. Case-insensitive. */
export function resolveProviderAlias(
	input: string,
	providers: ReadonlyArray<{ id: string; aliases?: readonly string[] }>,
): string | undefined {
	const q = input.trim().toLowerCase();
	for (const p of providers) {
		if (p.id.toLowerCase() === q) return p.id;
		if (p.aliases?.some((a) => a.toLowerCase() === q)) return p.id;
	}
	return undefined;
}

/**
 * Parse a `/login [provider]` command (F5). Mirrors `/compact` arg parsing.
 *  - bare `/login` (or trailing whitespace only) → open the provider selector.
 *  - `/login <provider>` with a known provider → route directly to that provider.
 *  - `/login <provider>` with an unknown provider → `invalid` (caller lists valid ones).
 */
export function parseLoginCommand(
	text: string,
	providers: ReadonlyArray<{ id: string; aliases?: readonly string[] }>,
): { kind: "selector" } | { kind: "provider"; provider: string } | { kind: "invalid"; provider: string } {
	const arg = text.startsWith("/login ") ? text.slice("/login ".length).trim() : "";
	if (arg === "") {
		return { kind: "selector" };
	}
	const id = resolveProviderAlias(arg, providers);
	if (id) {
		return { kind: "provider", provider: id };
	}
	return { kind: "invalid", provider: arg };
}

export function formatProviderChoices(providers: ReadonlyArray<{ id: string; aliases?: readonly string[] }>): string {
	return providers.map((p) => (p.aliases?.length ? `${p.id} (${p.aliases.join(", ")})` : p.id)).join(", ");
}
