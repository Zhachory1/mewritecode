// discovery.ts — find and load MCP config files.
//
// Default discovery preserves historical compatibility:
//   package: optional package-shipped config when provided by a wrapper
//   project: <cwd>/.mcp.json, then <cwd>/.cave/mcp.json
//   user:    ~/.cave/mcp.json, ~/.claude/mcp.json, ~/.codex/mcp.json
//
// Downstream distributions can pass a policy that disables those compatibility
// paths and reads only a package-shipped .mcp.json.
//
// Schema is byte-compatible with Claude Code / Codex `mcp.json`. A user can
// paste their existing config in unchanged and it will load.
//

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpConfigFile, McpServerConfig, McpSettings } from "./types.js";

export interface DiscoverySource {
	scope: "package" | "project" | "user";
	path: string;
	exists: boolean;
}

export interface LoadedConfig {
	servers: McpServerConfig[];
	settings: McpSettings;
	sources: DiscoverySource[];
	errors: Array<{ path: string; message: string }>;
}

export interface McpDiscoveryOptions {
	configDirName?: string;
	legacyConfigDirNames?: readonly string[];
	includeRootProjectConfig?: boolean;
	includeProjectConfigDir?: boolean;
	includeUserConfigDir?: boolean;
	includeClaudeConfig?: boolean;
	includeCodexConfig?: boolean;
	packageConfigPath?: string;
	packageConfigPaths?: readonly string[];
}

function unique(paths: string[]): string[] {
	return [...new Set(paths)];
}

function projectPaths(options: McpDiscoveryOptions = {}): string[] {
	const configDirName = options.configDirName ?? ".cave";
	const legacyConfigDirNames = options.legacyConfigDirNames ?? [".cave"];
	const paths = [
		...(options.includeProjectConfigDir === false ? [] : [join(configDirName, "mcp.json")]),
		...legacyConfigDirNames.map((dir) => join(dir, "mcp.json")),
	];
	if (options.includeRootProjectConfig !== false) paths.unshift(".mcp.json");
	return unique(paths);
}

function userPaths(home: string, options: McpDiscoveryOptions = {}): string[] {
	const configDirName = options.configDirName ?? ".cave";
	const legacyConfigDirNames = options.legacyConfigDirNames ?? [".cave"];
	const paths = [
		...(options.includeUserConfigDir === false ? [] : [join(home, configDirName, "mcp.json")]),
		...legacyConfigDirNames.map((dir) => join(home, dir, "mcp.json")),
	];
	if (options.includeClaudeConfig !== false) paths.push(join(home, ".claude", "mcp.json"));
	if (options.includeCodexConfig !== false) paths.push(join(home, ".codex", "mcp.json"));
	return unique(paths);
}

export function getProjectConfigPath(cwd = process.cwd(), options: McpDiscoveryOptions = {}): string {
	const path =
		options.includeRootProjectConfig === false ? join(options.configDirName ?? ".cave", "mcp.json") : ".mcp.json";
	return resolve(cwd, path);
}

export function getUserConfigPath(home = homedir(), options: McpDiscoveryOptions = {}): string {
	return join(home, options.configDirName ?? ".cave", "mcp.json");
}

export function getDiscoverySources(
	cwd = process.cwd(),
	home = homedir(),
	options: McpDiscoveryOptions = {},
): DiscoverySource[] {
	const out: DiscoverySource[] = [];
	const packagePaths = unique([
		...(options.packageConfigPath ? [options.packageConfigPath] : []),
		...(options.packageConfigPaths ?? []),
	]);
	for (const packagePath of packagePaths) {
		out.push({ scope: "package", path: packagePath, exists: existsSync(packagePath) });
	}
	for (const rel of projectPaths(options)) {
		const p = resolve(cwd, rel);
		out.push({ scope: "project", path: p, exists: existsSync(p) });
	}
	for (const p of userPaths(home, options)) {
		out.push({ scope: "user", path: p, exists: existsSync(p) });
	}
	return out;
}

function safeParse(path: string, errors: Array<{ path: string; message: string }>): McpConfigFile | undefined {
	try {
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(text) as McpConfigFile;
		if (!parsed || typeof parsed !== "object") {
			errors.push({ path, message: "expected JSON object" });
			return undefined;
		}
		return parsed;
	} catch (err) {
		errors.push({ path, message: err instanceof Error ? err.message : String(err) });
		return undefined;
	}
}

function entriesToConfigs(parsed: McpConfigFile | undefined): McpServerConfig[] {
	if (!parsed?.mcpServers) return [];
	const out: McpServerConfig[] = [];
	for (const [name, raw] of Object.entries(parsed.mcpServers)) {
		if (!raw || typeof raw !== "object") continue;
		out.push({ ...(raw as Omit<McpServerConfig, "name">), name });
	}
	return out;
}

/**
 * Load and merge MCP config files. Package config provides defaults, user config
 * overrides package config, and project config overrides both on name collisions.
 */
export function loadMcpConfig(cwd = process.cwd(), home = homedir(), options: McpDiscoveryOptions = {}): LoadedConfig {
	const sources = getDiscoverySources(cwd, home, options);
	const errors: Array<{ path: string; message: string }> = [];
	const byName = new Map<string, McpServerConfig>();
	let settings: McpSettings = {};

	for (const packageSource of sources.filter((s) => s.scope === "package" && s.exists)) {
		const parsed = safeParse(packageSource.path, errors);
		for (const c of entriesToConfigs(parsed)) byName.set(c.name, c);
		if (parsed?.settings) settings = { ...settings, ...parsed.settings };
	}

	const userSource = sources.find((s) => s.scope === "user" && s.exists);
	if (userSource) {
		const parsed = safeParse(userSource.path, errors);
		for (const c of entriesToConfigs(parsed)) byName.set(c.name, c);
		if (parsed?.settings) settings = { ...settings, ...parsed.settings };
	}

	const projectSource = sources.find((s) => s.scope === "project" && s.exists);
	if (projectSource) {
		const parsed = safeParse(projectSource.path, errors);
		for (const c of entriesToConfigs(parsed)) byName.set(c.name, c);
		if (parsed?.settings) settings = { ...settings, ...parsed.settings };
	}

	return {
		servers: [...byName.values()],
		settings,
		sources,
		errors,
	};
}
