// inproc.ts — in-process MCP transport (zero-spawn).
//
// For cave's own tools or any tool that lives in the same Node process. Calls
// the tool's `call()` directly without serialization. The fastest possible
// transport — used for the cave→cave path in `caveman mcp-server` mode and any
// "fake" servers tests want to wire up without subprocesses.

import type { McpTool } from "../serve.js";
import type { McpRemoteTool, McpTransport } from "../types.js";

export class InProcessTransport implements McpTransport {
	readonly kind = "inproc" as const;
	private connected = false;

	constructor(
		private readonly serverName: string,
		private readonly tools: McpTool[],
	) {}

	async connect(): Promise<void> {
		this.connected = true;
	}

	async listTools(): Promise<McpRemoteTool[]> {
		if (!this.connected) throw new Error(`mcp(inproc:${this.serverName}): not connected`);
		return this.tools.map((t) => ({
			name: t.name,
			namespacedName: `mcp__${this.serverName}__${t.name}`,
			server: this.serverName,
			description: t.description,
			inputSchema: t.schema,
		}));
	}

	async callTool(name: string, args: unknown): Promise<unknown> {
		if (!this.connected) throw new Error(`mcp(inproc:${this.serverName}): not connected`);
		const tool = this.tools.find((t) => t.name === name);
		if (!tool) throw new Error(`mcp(inproc:${this.serverName}): tool not found: ${name}`);
		return tool.call(args);
	}

	async close(): Promise<void> {
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}
}
