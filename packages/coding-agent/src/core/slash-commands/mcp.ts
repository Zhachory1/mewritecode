// /mcp slash command handler.
//
// Lives in `slash-commands/mcp.ts` because the plan singles it out, and so
// WS5's slash-commands refactor can pick it up without touching this file.
// Today's hand-off contract: the interactive layer dispatches on the literal
// command string and calls `runMcpSlashCommand()` with the rest of the line.
//
// Subcommands (mirror the configured `mcp` CLI surface):
//   /mcp                  → list (default)
//   /mcp list             → show configured servers
//   /mcp add <name> ...   → add a server (delegates to mcp-cli helper)
//   /mcp remove <name>    → remove a server
//   /mcp doctor           → health probe across configured servers
//   /mcp login <name>     → kick off OAuth (currently stubbed with hint text)
//   /mcp reload           → reconnect everything

import { mcp as agentMcp } from "@zhachory1/mewrite-agent";
import { APP_NAME, DISPLAY_NAME, MCP_DISCOVERY_OPTIONS } from "../../config.js";

export interface SlashContext {
	cwd: string;
	/**
	 * Optional pre-built hub. If absent, we reload from disk every call —
	 * that's fine for ad-hoc /mcp invocations, and the warm pool inside the
	 * hub means subsequent slash calls still reuse connected transports.
	 */
	hub?: agentMcp.McpHub;
	mcpDiscoveryOptions?: agentMcp.McpDiscoveryOptions;
}

export interface SlashResult {
	/** Lines printed back to the TUI / stdout. */
	lines: string[];
	/** Optional error count (for non-zero exits in CLI mode). */
	errors: number;
}

function ok(...lines: string[]): SlashResult {
	return { lines, errors: 0 };
}

function fail(...lines: string[]): SlashResult {
	return { lines, errors: 1 };
}

/** Parse `/mcp <verb> <args...>` into pieces. */
export function parseMcpSlash(line: string): { verb: string; args: string[] } {
	const trimmed = line.replace(/^\/mcp\s*/, "").trim();
	if (trimmed.length === 0) return { verb: "list", args: [] };
	const parts = trimmed.split(/\s+/);
	return { verb: parts[0], args: parts.slice(1) };
}

async function buildHub(ctx: SlashContext): Promise<agentMcp.McpHub> {
	if (ctx.hub) return ctx.hub;
	const loaded = agentMcp.loadMcpConfig(ctx.cwd, undefined, ctx.mcpDiscoveryOptions ?? MCP_DISCOVERY_OPTIONS);
	const hub = new agentMcp.McpHub({ settings: loaded.settings });
	for (const server of loaded.servers) hub.addServer(server);
	return hub;
}

async function runList(ctx: SlashContext): Promise<SlashResult> {
	const loaded = agentMcp.loadMcpConfig(ctx.cwd, undefined, ctx.mcpDiscoveryOptions ?? MCP_DISCOVERY_OPTIONS);
	if (loaded.errors.length > 0) {
		return fail("MCP config errors:", ...loaded.errors.map((e) => `  ${e.path}: ${e.message}`));
	}
	if (loaded.servers.length === 0) {
		const hint = `No MCP servers configured. Discovery checked:\n${loaded.sources
			.map((s) => `  ${s.exists ? "✓" : " "} ${s.scope}: ${s.path}`)
			.join("\n")}`;
		return ok(hint, "Add a server: /mcp add <name> <command> [args...]");
	}
	const lines = ["Configured MCP servers:"];
	for (const s of loaded.servers) {
		const transport = s.transport ?? (s.url ? "http" : "stdio");
		const target = s.command ? `${s.command} ${(s.args ?? []).join(" ")}`.trim() : (s.url ?? "—");
		lines.push(`  ${s.name} [${transport}] → ${target}`);
	}
	return ok(...lines);
}

async function runDoctor(ctx: SlashContext): Promise<SlashResult> {
	const hub = await buildHub(ctx);
	if (hub.listServers().length === 0) {
		return ok("No MCP servers configured. Run /mcp add to add one.");
	}
	const health = await hub.healthCheck();
	const lines = ["MCP doctor:"];
	let errors = 0;
	for (const h of health) {
		const status = h.reachable ? "ok" : "DOWN";
		const detail = h.error ? `   error: ${h.error}` : `   tools: ${h.tools}`;
		lines.push(`  [${h.transport}] ${h.name}: ${status}`);
		lines.push(detail);
		if (!h.reachable) errors++;
	}
	return { lines, errors };
}

async function runLogin(args: string[]): Promise<SlashResult> {
	if (args.length === 0) return fail("Usage: /mcp login <server>");
	const name = args[0];
	// TODO(ws2-oauth): implement full PKCE flow. Two-tool pattern:
	//   1. authenticate(server)         → returns auth URL + state
	//   2. complete_authentication(...) → finalizes; persists to keystore
	// For now, surface the contract so the model knows what to do.
	return ok(
		`/mcp login ${name}: OAuth 2.1 + PKCE flow not yet wired (WS2 follow-up).`,
		"Workaround: set bearerTokenEnv on the server entry in .mcp.json and",
		`export the token in the shell. ${DISPLAY_NAME} will pick it up on next /mcp reload.`,
	);
}

export async function runMcpSlashCommand(line: string, ctx: SlashContext): Promise<SlashResult> {
	const { verb, args } = parseMcpSlash(line);
	switch (verb) {
		case "":
		case "list":
		case "ls":
			return runList(ctx);
		case "doctor":
		case "health":
			return runDoctor(ctx);
		case "login":
			return runLogin(args);
		case "add":
		case "remove":
		case "rm":
			return ok(
				`Use the CLI form for now: ${APP_NAME} mcp ${verb} ${args.join(" ")}`,
				"Slash-side mutations land with WS5 (commands registry refactor).",
			);
		case "reload":
			// Reload is a hint to the surrounding agent — the slash handler is
			// stateless here, so signal success and let the host reconfigure.
			return ok("MCP config reload requested.");
		default:
			return fail(
				`Unknown /mcp subcommand: ${verb}`,
				"Try: /mcp list | /mcp doctor | /mcp login <server> | /mcp reload",
			);
	}
}

/**
 * Slash command metadata that WS5's slash-commands registry can pull in.
 * Until WS5 lands, this is consumed by `BUILTIN_SLASH_COMMANDS` in
 * `slash-commands.ts`.
 */
export const MCP_SLASH_COMMAND = {
	name: "mcp",
	description: `Manage MCP servers (list, doctor, login, reload). See: ${APP_NAME} mcp --help.`,
} as const;
