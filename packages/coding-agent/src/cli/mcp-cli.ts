// mcp-cli.ts — `mewrite mcp <subcommand>` handler.
//
// Subcommands:
//   mewrite mcp list                                     → show configured servers
//   mewrite mcp doctor                                   → health probe + tool counts
//   mewrite mcp add <name> --command "<cmd>" [--arg ...] → add a stdio server
//   mewrite mcp add <name> --url <url> [--auth oauth]    → add an HTTP server
//   mewrite mcp remove <name>                            → remove a server
//   mewrite mcp login <name>                             → OAuth login (stub)
//   mewrite mcp-server                                   → run cave AS an MCP server
//
// Servers persist to project `.mcp.json` (default) or user `~/.cave/mcp.json`
// (`--user`). Schema is byte-compat with Claude Code / Codex `.mcp.json`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { mcp as agentMcp } from "@zhachory1/mewrite-agent";
import chalk from "chalk";
import { runMcpSlashCommand } from "../core/slash-commands/mcp.js";

type McpConfigFile = agentMcp.McpConfigFile;
type McpServerConfig = agentMcp.McpServerConfig;

interface AddOptions {
	name: string;
	command?: string;
	args?: string[];
	url?: string;
	auth?: "oauth" | "bearer";
	bearerTokenEnv?: string;
	user: boolean;
}

function readConfigFile(path: string): McpConfigFile {
	if (!existsSync(path)) return { mcpServers: {} };
	try {
		return JSON.parse(readFileSync(path, "utf8")) as McpConfigFile;
	} catch (err) {
		throw new Error(`failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function writeConfigFile(path: string, data: McpConfigFile): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function configPath(scope: "user" | "project", cwd: string): string {
	return scope === "user" ? agentMcp.getUserConfigPath(homedir()) : agentMcp.getProjectConfigPath(cwd);
}

function parseAdd(args: string[]): AddOptions {
	if (args.length === 0) throw new Error("usage: mewrite mcp add <name> [--command <cmd>] [--url <url>] [--user]");
	const name = args[0];
	const opts: AddOptions = { name, user: false, args: [] };
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--command":
			case "-c":
				opts.command = args[++i];
				break;
			case "--arg":
				opts.args!.push(args[++i]);
				break;
			case "--url":
			case "-u":
				opts.url = args[++i];
				break;
			case "--auth":
				opts.auth = args[++i] as "oauth" | "bearer";
				break;
			case "--bearer-env":
				opts.bearerTokenEnv = args[++i];
				break;
			case "--user":
				opts.user = true;
				break;
			default:
				// shorthand: anything left over after --command becomes args
				if (opts.command && !opts.url) opts.args!.push(a);
				break;
		}
	}
	if (!opts.command && !opts.url) throw new Error("must supply --command <cmd> or --url <url>");
	return opts;
}

function printList(cwd: string): number {
	const loaded = agentMcp.loadMcpConfig(cwd);
	if (loaded.errors.length > 0) {
		for (const e of loaded.errors) console.error(chalk.yellow(`Warning: ${e.path}: ${e.message}`));
	}
	if (loaded.servers.length === 0) {
		console.log("No MCP servers configured.");
		console.log("Discovery checked:");
		for (const s of loaded.sources) {
			console.log(`  ${s.exists ? "✓" : " "} ${s.scope}: ${s.path}`);
		}
		return 0;
	}
	console.log("Configured MCP servers:");
	for (const s of loaded.servers) {
		const transport = s.transport ?? (s.url ? "http" : "stdio");
		const target = s.command ? `${s.command} ${(s.args ?? []).join(" ")}`.trim() : (s.url ?? "—");
		console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`[${transport}]`)} → ${target}`);
	}
	return 0;
}

async function printDoctor(cwd: string): Promise<number> {
	const result = await runMcpSlashCommand("/mcp doctor", { cwd });
	for (const line of result.lines) console.log(line);
	return result.errors > 0 ? 1 : 0;
}

function doAdd(args: string[], cwd: string): number {
	const opts = parseAdd(args);
	const path = configPath(opts.user ? "user" : "project", cwd);
	const data = readConfigFile(path);
	if (!data.mcpServers) data.mcpServers = {};
	const entry: Omit<McpServerConfig, "name"> = {};
	if (opts.command) {
		entry.command = opts.command;
		if (opts.args && opts.args.length > 0) entry.args = opts.args;
	}
	if (opts.url) entry.url = opts.url;
	if (opts.auth) entry.auth = opts.auth;
	if (opts.bearerTokenEnv) entry.bearerTokenEnv = opts.bearerTokenEnv;
	data.mcpServers[opts.name] = entry;
	writeConfigFile(path, data);
	console.log(`Added MCP server '${opts.name}' to ${path}`);
	return 0;
}

function doRemove(args: string[], cwd: string): number {
	if (args.length === 0) {
		console.error("usage: mewrite mcp remove <name> [--user]");
		return 1;
	}
	const name = args[0];
	const user = args.includes("--user");
	const path = configPath(user ? "user" : "project", cwd);
	if (!existsSync(path)) {
		console.error(`No config file at ${path}`);
		return 1;
	}
	const data = readConfigFile(path);
	if (!data.mcpServers || !(name in data.mcpServers)) {
		console.error(`No such server: ${name}`);
		return 1;
	}
	delete data.mcpServers[name];
	writeConfigFile(path, data);
	console.log(`Removed MCP server '${name}' from ${path}`);
	return 0;
}

async function doLogin(args: string[], cwd: string): Promise<number> {
	const result = await runMcpSlashCommand(`/mcp login ${args.join(" ")}`, { cwd });
	for (const line of result.lines) console.log(line);
	return result.errors;
}

function printHelp(): void {
	console.log(`Usage: mewrite mcp <subcommand> [args...]

Subcommands:
  list                              List configured MCP servers (project + user).
  doctor                            Connect to each server and report health + tool count.
  add <name> --command <cmd> [...]  Add a stdio MCP server (use --arg multiple times for args).
  add <name> --url <url> [...]      Add an HTTP MCP server (--auth oauth | bearer, --bearer-env VAR).
  remove <name> [--user]            Remove a server from project (default) or user config.
  login <name>                      OAuth 2.1 + PKCE login (stub for now — see TODO(ws2-oauth)).

Options:
  --user                            Operate on ~/.cave/mcp.json instead of ./.mcp.json

Format compat:
  cave reads ./.mcp.json, ./.cave/mcp.json, ~/.cave/mcp.json, ~/.claude/mcp.json,
  ~/.codex/mcp.json. Schema is byte-compatible with Claude Code and Codex.`);
}

export async function handleMcpCommand(args: string[]): Promise<boolean> {
	if (args.length === 0 || args[0] !== "mcp") {
		// also handle `mewrite mcp-server` mode
		if (args[0] === "mcp-server") {
			await runCaveAsMcpServer();
			return true;
		}
		return false;
	}
	const sub = args[1];
	const rest = args.slice(2);
	const cwd = process.cwd();
	try {
		let exit = 0;
		switch (sub) {
			case undefined:
			case "list":
			case "ls":
				exit = printList(cwd);
				break;
			case "doctor":
			case "health":
				exit = await printDoctor(cwd);
				break;
			case "add":
				exit = doAdd(rest, cwd);
				break;
			case "remove":
			case "rm":
				exit = doRemove(rest, cwd);
				break;
			case "login":
				exit = await doLogin(rest, cwd);
				break;
			case "help":
			case "--help":
			case "-h":
				printHelp();
				exit = 0;
				break;
			default:
				console.error(`Unknown subcommand: ${sub}`);
				printHelp();
				exit = 1;
		}
		if (exit !== 0) process.exitCode = exit;
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		process.exitCode = 1;
	}
	return true;
}

/**
 * `mewrite mcp-server` mode — cave acts AS an MCP server over stdio.
 *
 * This is the Codex pattern (cave-as-MCP-server) so other agents can call cave.
 * Today it serves the cave-side tools list. The full implementation lands with
 * a follow-up that wires the actual @zhachory1/mewrite-code tool surface in.
 */
async function runCaveAsMcpServer(): Promise<void> {
	const server = new agentMcp.McpServer();
	// Future: pull tools from @zhachory1/mewrite-code allTools and register here.
	server.register({
		name: "cave_health",
		description: "Returns 'ok' if cave is responding.",
		schema: { type: "object", properties: {} },
		call: () => ({ status: "ok", version: "v2" }),
	});

	let buf = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", async (chunk) => {
		buf += chunk;
		let idx = buf.indexOf("\n");
		while (idx !== -1) {
			const line = buf.slice(0, idx).trim();
			buf = buf.slice(idx + 1);
			if (line.length > 0) {
				try {
					const req = JSON.parse(line);
					const resp = await server.handle(req);
					process.stdout.write(`${JSON.stringify(resp)}\n`);
				} catch (err) {
					process.stderr.write(`mcp-server: bad request: ${err}\n`);
				}
			}
			idx = buf.indexOf("\n");
		}
	});
	process.stdin.on("end", () => process.exit(0));
}
