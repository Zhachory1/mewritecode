// discovery.ts — find and load .mcp.json files.
//
// Project: <cwd>/.mcp.json (preferred), branded <cwd>/<configDir>/mcp.json,
// or legacy <cwd>/.cave/mcp.json (fallback).
// User:    branded ~/<configDir>/mcp.json, legacy ~/.cave/mcp.json, or
// ~/.claude / ~/.codex compatibility configs.
//
// Schema is byte-compatible with Claude Code / Codex `mcp.json`. A user can
// paste their existing config in unchanged and it will load.
//

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpConfigFile, McpServerConfig, McpSettings } from "./types.js";

export interface DiscoverySource {
	scope: "project" | "user";
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
}

function unique(paths: string[]): string[] {
	return [...new Set(paths)];
}

function projectPaths(configDirName = ".cave", legacyConfigDirNames: readonly string[] = [".cave"]): string[] {
	return unique([
		".mcp.json",
		join(configDirName, "mcp.json"),
		...legacyConfigDirNames.map((dir) => join(dir, "mcp.json")),
	]);
}

function userPaths(
	home: string,
	configDirName = ".cave",
	legacyConfigDirNames: readonly string[] = [".cave"],
): string[] {
	return unique([
		join(home, configDirName, "mcp.json"),
		...legacyConfigDirNames.map((dir) => join(home, dir, "mcp.json")),
		join(home, ".claude", "mcp.json"),
		join(home, ".codex", "mcp.json"),
	]);
}

export function getProjectConfigPath(cwd = process.cwd(), options: McpDiscoveryOptions = {}): string {
	return resolve(cwd, projectPaths(options.configDirName, options.legacyConfigDirNames)[0]);
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
	for (const rel of projectPaths(options.configDirName, options.legacyConfigDirNames)) {
		const p = resolve(cwd, rel);
		out.push({ scope: "project", path: p, exists: existsSync(p) });
	}
	for (const p of userPaths(home, options.configDirName, options.legacyConfigDirNames)) {
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
 * Load and merge MCP config files. Project-scope wins over user-scope on name
 * collisions; the first existing file at each scope is the authoritative one.
 */
export function loadMcpConfig(cwd = process.cwd(), home = homedir(), options: McpDiscoveryOptions = {}): LoadedConfig {
	const sources = getDiscoverySources(cwd, home, options);
	const errors: Array<{ path: string; message: string }> = [];
	const byName = new Map<string, McpServerConfig>();
	let settings: McpSettings = {};

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
