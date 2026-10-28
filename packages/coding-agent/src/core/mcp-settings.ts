/**
 * MCP server settings for RPC clients: list configured servers and edit stdio
 * servers in the writable project/user mcp.json files. Changes apply to new sessions.
 *
 * Edits carry the revision (sha256 of the file) the client last read and fail if
 * the file changed since, so a stale settings view can't overwrite newer edits.
 * Edits are synchronous, so edits within one process can't interleave; a separate
 * process writing the same file between the final check and the rename can still win.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { mcp as agentMcp } from "@zhachory1/mewrite-agent";
import { MCP_DISCOVERY_OPTIONS } from "../config.js";

export type McpScope = "project" | "user";

export interface McpServerSummary {
	name: string;
	owner: McpScope | "other";
	transport: string;
	status: "configured";
	editable: boolean;
	removable: boolean;
	hasArguments: boolean;
}

export interface McpServerInventory {
	servers: McpServerSummary[];
	revisions: Record<McpScope, string>;
	errors: Array<{ owner: McpScope | "other"; message: string }>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const BASIC_KEYS = new Set(["command", "args", "transport"]);

type ServerEntry = Omit<agentMcp.McpServerConfig, "name">;

// The file loadMcpConfig reads for this scope (first existing source, e.g. a legacy
// dir), else the default path. Writing elsewhere would shadow the existing file.
function configPath(scope: McpScope, cwd: string, home: string): string {
	const existing = agentMcp
		.getDiscoverySources(cwd, home, MCP_DISCOVERY_OPTIONS)
		.find((source) => source.scope === scope && source.exists);
	if (existing) return existing.path;
	return scope === "project"
		? agentMcp.getProjectConfigPath(cwd, MCP_DISCOVERY_OPTIONS)
		: agentMcp.getUserConfigPath(home, MCP_DISCOVERY_OPTIONS);
}

function readText(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

const revisionOf = (text: string | undefined) =>
	createHash("sha256")
		.update(text ?? "\0missing")
		.digest("hex");

function parseServers(text: string | undefined): Record<string, ServerEntry> {
	if (text === undefined) return {};
	const parsed = JSON.parse(text) as agentMcp.McpConfigFile;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("MCP config must be a JSON object");
	return parsed.mcpServers ?? {};
}

const isStdio = (entry: ServerEntry) =>
	!entry.url && (entry.transport === undefined || entry.transport === "stdio") && typeof entry.command === "string";

export function getMcpServers(cwd: string, home = homedir()): McpServerInventory {
	const loaded = agentMcp.loadMcpConfig(cwd, home, MCP_DISCOVERY_OPTIONS);
	const revisions = {} as Record<McpScope, string>;
	const writable = {} as Record<McpScope, Record<string, ServerEntry>>;
	const errors: McpServerInventory["errors"] = [];
	for (const scope of ["project", "user"] as const) {
		const text = readText(configPath(scope, cwd, home));
		revisions[scope] = revisionOf(text);
		try {
			writable[scope] = parseServers(text);
		} catch {
			writable[scope] = {};
			errors.push({ owner: scope, message: "MCP config could not be loaded" });
		}
	}
	const writablePaths = new Set((["project", "user"] as const).map((scope) => configPath(scope, cwd, home)));
	for (const error of loaded.errors) {
		if (!writablePaths.has(error.path)) errors.push({ owner: "other", message: "MCP config could not be loaded" });
	}
	return {
		servers: loaded.servers.map((server) => {
			// Project config wins over user config on name collisions, matching loadMcpConfig.
			const owner: McpScope | "other" =
				server.name in writable.project ? "project" : server.name in writable.user ? "user" : "other";
			const entry = owner === "other" ? undefined : writable[owner][server.name];
			const stdio = entry !== undefined && isStdio(entry);
			return {
				name: server.name,
				owner,
				transport: server.transport ?? (server.url ? "http" : server.command ? "stdio" : "unknown"),
				status: "configured",
				editable: stdio && Object.keys(entry).every((key) => BASIC_KEYS.has(key)),
				removable: stdio,
				hasArguments: Array.isArray(server.args) && server.args.length > 0,
			};
		}),
		revisions,
		errors,
	};
}

function updateConfig(
	scope: McpScope,
	revision: unknown,
	cwd: string,
	home: string,
	update: (servers: Record<string, ServerEntry>) => void,
): void {
	if (scope !== "project" && scope !== "user") throw new Error("Invalid MCP config scope");
	const path = configPath(scope, cwd, home);
	if (existsSync(path) && lstatSync(path).isSymbolicLink())
		throw new Error("MCP config is a symlink and cannot be edited");
	const text = readText(path);
	if (revision !== revisionOf(text)) throw new Error("MCP config changed; refresh and retry");
	let config: agentMcp.McpConfigFile;
	try {
		config = text === undefined ? {} : (JSON.parse(text) as agentMcp.McpConfigFile);
	} catch {
		throw new Error("MCP config contains invalid JSON");
	}
	config.mcpServers = config.mcpServers ?? {};
	update(config.mcpServers);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.tmp-${randomUUID()}`;
	try {
		writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		if (revisionOf(readText(path)) !== revision) throw new Error("MCP config changed; refresh and retry");
		renameSync(temp, path);
	} finally {
		rmSync(temp, { force: true });
	}
}

export interface SaveMcpServerInput {
	scope: McpScope;
	revision: string;
	previousName?: string;
	name: string;
	transport: "stdio";
	command: string;
	args: string[];
}

export function saveMcpServer(input: SaveMcpServerInput, cwd: string, home = homedir()): { appliesTo: "next-session" } {
	if (!NAME.test(input.name) || (input.previousName !== undefined && !NAME.test(input.previousName))) {
		throw new Error("Invalid MCP server name");
	}
	if (input.transport !== "stdio") throw new Error("Only stdio MCP servers can be saved");
	if (
		typeof input.command !== "string" ||
		!input.command ||
		input.command.length > 4096 ||
		CONTROL.test(input.command)
	) {
		throw new Error("Invalid MCP server command");
	}
	if (
		!Array.isArray(input.args) ||
		input.args.length > 100 ||
		input.args.some((arg) => typeof arg !== "string" || arg.length > 4096 || CONTROL.test(arg))
	) {
		throw new Error("Invalid MCP server arguments");
	}
	updateConfig(input.scope, input.revision, cwd, home, (servers) => {
		const source = input.previousName ?? input.name;
		const existing = Object.hasOwn(servers, source) ? servers[source] : undefined;
		if (input.previousName !== undefined && !existing) throw new Error("MCP server not found");
		if (input.name !== source && Object.hasOwn(servers, input.name)) throw new Error("MCP server already exists");
		if (existing && (!isStdio(existing) || !Object.keys(existing).every((key) => BASIC_KEYS.has(key)))) {
			throw new Error("Only basic stdio MCP servers can be edited here");
		}
		delete servers[source];
		servers[input.name] = { command: input.command, args: input.args, transport: "stdio" };
	});
	return { appliesTo: "next-session" };
}

export function removeMcpServer(
	input: { scope: McpScope; revision: string; name: string },
	cwd: string,
	home = homedir(),
): { appliesTo: "next-session" } {
	if (!NAME.test(input.name)) throw new Error("Invalid MCP server name");
	updateConfig(input.scope, input.revision, cwd, home, (servers) => {
		const entry = Object.hasOwn(servers, input.name) ? servers[input.name] : undefined;
		if (!entry) throw new Error("MCP server not found");
		if (!isStdio(entry)) throw new Error("Only stdio MCP servers can be removed here");
		delete servers[input.name];
	});
	return { appliesTo: "next-session" };
}
