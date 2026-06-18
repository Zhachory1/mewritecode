/**
 * Agent definition loader — discovers `.cave/agents/<name>.md` (project) and
 * `~/.cave/agents/<name>.md` (user) and parses their Claude Code-compatible
 * frontmatter into `SubagentDef` records.
 *
 * Discovery (in order; later entries override earlier on name collision):
 *   1. Bundled defaults: `<package>/agents/*.md` (this repo's defaults)
 *   2. User scope:       `~/.cave/agents/*.md`
 *   3. Project scope:    `<cwd>/.cave/agents/*.md`
 *
 * Frontmatter (Claude Code v2.1.119 superset — see SubagentDef in @zhachory1/mewrite-agent):
 *   description, prompt (body), tools, disallowedTools, model, mcpServers,
 *   hooks, maxTurns, skills, effort, background, isolation
 *
 * Output:
 *   - `LoadedAgentDef[]`  — successful definitions
 *   - `ResourceDiagnostic[]` — warnings / failures
 */

import { normalizeFrontmatterArray, type SubagentDef, validateSubagentDef } from "@zhachory1/mewrite-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir, getPackageDir } from "../../config.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
// note: from src/core/agent-defs/loader.ts → ../../ → src/ → config.ts
import type { ResourceDiagnostic } from "../diagnostics.js";
import { createSyntheticSourceInfo, type SourceInfo } from "../source-info.js";
import { VALID_TOOL_NAMES } from "../tools/tool-names.js";
import { classifyToolName, effectiveTools, isIncompleteWriteSet } from "./tool-name-check.js";

/** Loaded agent definition with source info. */
export interface LoadedAgentDef {
	def: SubagentDef;
	sourceInfo: SourceInfo;
}

export interface LoadAgentDefsOptions {
	/** Project working directory (search root for `.cave/agents/`). Defaults to process.cwd(). */
	cwd?: string;
	/** User config dir override (test injection). Defaults to `getAgentDir()`. */
	userDir?: string;
	/** Package dir override (for bundled defaults). Defaults to `getPackageDir()`. */
	packageDir?: string;
	/** Skip bundled defaults — useful for tests. */
	skipBundled?: boolean;
	/** Skip user scope — useful for tests. */
	skipUser?: boolean;
	/** Skip project scope — useful for tests. */
	skipProject?: boolean;
	/** Extra directories to scan (e.g. plugin-supplied). Loaded in order, after project. */
	extraDirs?: string[];
}

export interface LoadAgentDefsResult {
	agents: LoadedAgentDef[];
	diagnostics: ResourceDiagnostic[];
}

interface ScanResult {
	defs: LoadedAgentDef[];
	diagnostics: ResourceDiagnostic[];
}

const FRONTMATTER_KEYS_PASSTHROUGH = [
	"effort",
	"context",
	"agent",
	"hooks",
	"paths",
	"shell",
	"argument-hint",
	"arguments",
	"user-invocable",
	"disable-model-invocation",
] as const;

/**
 * Parse a single `.md` file into a SubagentDef + diagnostics.
 *
 * Returns `null` for the def if the file is unparseable / fails validation.
 */
export function parseAgentDefFile(
	filePath: string,
	source: SubagentDef["source"],
): {
	def: SubagentDef | null;
	diagnostics: ResourceDiagnostic[];
} {
	const diagnostics: ResourceDiagnostic[] = [];
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch (err) {
		diagnostics.push({
			type: "error",
			path: filePath,
			message: `failed to read agent def: ${(err as Error).message}`,
		});
		return { def: null, diagnostics };
	}

	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
	const fileName = basename(filePath, ".md");
	const name = (typeof frontmatter.name === "string" && frontmatter.name) || fileName;
	const description = typeof frontmatter.description === "string" ? frontmatter.description : "";

	const tools = normalizeFrontmatterArray(frontmatter.tools);
	const disallowedTools = normalizeFrontmatterArray(frontmatter.disallowedTools);
	const mcpServers = normalizeFrontmatterArray(frontmatter.mcpServers);
	const requiredMcpServers = normalizeFrontmatterArray(frontmatter.requiredMcpServers);
	const skills = normalizeFrontmatterArray(frontmatter.skills);

	const def: SubagentDef = {
		name,
		description,
		prompt: body,
		tools,
		disallowedTools,
		model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
		effort: typeof frontmatter.effort === "string" ? frontmatter.effort : undefined,
		isolation: frontmatter.isolation as SubagentDef["isolation"],
		mcpServers,
		requiredMcpServers,
		skills,
		hooks: (frontmatter.hooks ?? undefined) as Record<string, unknown> | undefined,
		maxTurns: typeof frontmatter.maxTurns === "number" ? frontmatter.maxTurns : undefined,
		background: typeof frontmatter.background === "boolean" ? frontmatter.background : undefined,
		omitClaudeMd: typeof frontmatter.omitClaudeMd === "boolean" ? frontmatter.omitClaudeMd : undefined,
		source,
		filePath,
	};

	// Pass through unknown CC keys verbatim so a user pasting
	// `~/.claude/agents/foo.md` keeps every field even if cave doesn't yet
	// wire it.
	for (const key of FRONTMATTER_KEYS_PASSTHROUGH) {
		if (key in frontmatter && !(key in def)) {
			(def as any)[key] = frontmatter[key];
		}
	}
	for (const key of Object.keys(frontmatter)) {
		if (
			!(key in def) &&
			!FRONTMATTER_KEYS_PASSTHROUGH.includes(key as (typeof FRONTMATTER_KEYS_PASSTHROUGH)[number])
		) {
			(def as any)[key] = frontmatter[key];
		}
	}

	const errors = validateSubagentDef(def);
	if (errors.length > 0) {
		for (const err of errors) {
			diagnostics.push({ type: "warning", path: filePath, message: err });
		}
		// We still return the def if it has at least name+description+prompt
		// — some validation errors are non-fatal.
		const fatal =
			errors.some((e) => e.startsWith("name is required")) ||
			errors.some((e) => e.startsWith("description is required")) ||
			errors.some((e) => e.startsWith("prompt body is required"));
		if (fatal) return { def: null, diagnostics };
	}

	// Validate tool / disallowedTools allow-list names — warn (never error) so a
	// typo or unknown tool is legible instead of being silently dropped by the child.
	for (const name of def.tools ?? []) {
		const issue = classifyToolName(name);
		if (issue?.kind === "did-you-mean")
			diagnostics.push({
				type: "warning",
				path: filePath,
				message: `agent "${def.name}": tool "${name}" — did you mean "${issue.suggestion}"? (dropped as-is)`,
			});
		else if (issue?.kind === "unknown")
			diagnostics.push({
				type: "warning",
				path: filePath,
				message: `agent "${def.name}": unknown tool "${name}" — check spelling; it will be silently dropped. Known: ${VALID_TOOL_NAMES.join(", ")} (or an mcp__*/memory_* tool).`,
			});
	}
	for (const name of def.disallowedTools ?? []) {
		const issue = classifyToolName(name);
		if (issue)
			diagnostics.push({
				type: "warning",
				path: filePath,
				message: `agent "${def.name}": disallowedTools "${name}" matches no known tool — it won't block anything${issue.kind === "did-you-mean" ? ` (did you mean "${issue.suggestion}"?)` : ""}.`,
			});
	}
	const eff = effectiveTools(def.tools ?? [], def.disallowedTools ?? []);
	if (isIncompleteWriteSet(eff))
		diagnostics.push({
			type: "warning",
			path: filePath,
			message: `agent "${def.name}": has edit/write but no read/grep/ls/find — it can mutate files but cannot locate or inspect them first.`,
		});
	// disallowedTools cancelled out every allowed tool. The child passes no --tools
	// flag for an empty list, so it would silently inherit the default toolset
	// (read,bash,edit,write) — the opposite of an intended lock-down.
	if ((def.tools?.length ?? 0) > 0 && eff.length === 0)
		diagnostics.push({
			type: "warning",
			path: filePath,
			message: `agent "${def.name}": disallowedTools removes every entry in tools — the effective set is empty, so the agent inherits the default toolset instead of being restricted.`,
		});

	return { def, diagnostics };
}

function scanDir(dir: string, source: SubagentDef["source"]): ScanResult {
	const defs: LoadedAgentDef[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) return { defs, diagnostics };

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch (err) {
		diagnostics.push({
			type: "error",
			path: dir,
			message: `failed to read agents dir: ${(err as Error).message}`,
		});
		return { defs, diagnostics };
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const filePath = join(dir, entry);
		try {
			const stat = statSync(filePath);
			if (!stat.isFile()) continue;
		} catch {
			continue;
		}

		const { def, diagnostics: parseDiagnostics } = parseAgentDefFile(filePath, source);
		diagnostics.push(...parseDiagnostics);
		if (!def) continue;

		const scope = source === "project" ? "project" : source === "user" ? "user" : "temporary";
		const sourceInfo = createSyntheticSourceInfo(filePath, {
			source: source === "builtin" ? "builtin" : source === "plugin" ? "plugin" : "local",
			scope,
			baseDir: dir,
		});

		defs.push({ def, sourceInfo });
	}

	return { defs, diagnostics };
}

/**
 * Load agent definitions from all scopes per discovery rules.
 *
 * Later scopes override earlier on name collision (project > user > builtin).
 */
export function loadAgentDefs(options: LoadAgentDefsOptions = {}): LoadAgentDefsResult {
	const cwd = options.cwd ?? process.cwd();
	const userBase = options.userDir ?? getAgentDir();
	const packageBase = options.packageDir ?? getPackageDir();

	const all: LoadedAgentDef[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	const byName = new Map<string, LoadedAgentDef>();

	const merge = (results: ScanResult) => {
		diagnostics.push(...results.diagnostics);
		for (const d of results.defs) {
			byName.set(d.def.name, d);
		}
	};

	// 1. Bundled defaults — package/agents/
	if (!options.skipBundled) {
		const bundledDir = join(packageBase, "agents");
		merge(scanDir(bundledDir, "builtin"));
	}

	// 2. User scope — ~/.cave/agents/ (CC-compatible alias: ~/.claude/agents/)
	if (!options.skipUser) {
		merge(scanDir(join(userBase, "agents"), "user"));
	}

	// 3. Project scope — <cwd>/.cave/agents/
	if (!options.skipProject) {
		merge(scanDir(join(cwd, CONFIG_DIR_NAME, "agents"), "project"));
	}

	// 4. Plugin / extra dirs
	if (options.extraDirs && options.extraDirs.length > 0) {
		for (const dir of options.extraDirs) {
			merge(scanDir(resolve(dir), "plugin"));
		}
	}

	for (const def of byName.values()) all.push(def);

	return { agents: all, diagnostics };
}

/**
 * Lookup helper used by the Task / Agent tools.
 */
export function findAgentDef(loaded: LoadAgentDefsResult, name: string): LoadedAgentDef | undefined {
	return loaded.agents.find((a) => a.def.name === name);
}

/**
 * Format a list of available agents for error / "agent not found" messages.
 */
export function formatAgentList(loaded: LoadAgentDefsResult, max = 8): string {
	if (loaded.agents.length === 0) return "(no agents loaded)";
	const lines = loaded.agents.slice(0, max).map((a) => `  - ${a.def.name} (${a.def.source}): ${a.def.description}`);
	if (loaded.agents.length > max) {
		lines.push(`  - … +${loaded.agents.length - max} more`);
	}
	return lines.join("\n");
}

/** Resolve the bundled agents dir relative to the cave package root. */
export function getBundledAgentsDir(): string {
	return join(getPackageDir(), "agents");
}

/** Resolve the user's agents dir (`~/.cave/agents/`). */
export function getUserAgentsDir(): string {
	return join(getAgentDir(), "agents");
}

/** Resolve the project's agents dir (`<cwd>/.cave/agents/`). */
export function getProjectAgentsDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "agents");
}

/**
 * Returns true when every pattern in `requiredMcpServers` matches at least one
 * entry in `availableServers` (case-insensitive substring match — same shape
 * as claude-code loadAgentsDir.ts:233-242).
 */
function readRequiredMcpServers(def: SubagentDef): string[] {
	const raw = (def as { requiredMcpServers?: unknown }).requiredMcpServers;
	return Array.isArray(raw) ? (raw as string[]) : [];
}

export function agentMcpRequirementsMet(def: SubagentDef, availableServers: string[]): boolean {
	const required = readRequiredMcpServers(def);
	if (required.length === 0) return true;
	const haystack = availableServers.map((s) => s.toLowerCase());
	return required.every((pattern) => {
		const needle = pattern.toLowerCase();
		return haystack.some((s) => s.includes(needle));
	});
}

/**
 * Filter loaded agents to those whose `requiredMcpServers` are all available.
 * Diagnostics are appended to explain why an agent was hidden.
 */
export function filterAgentsByMcpAvailability(
	loaded: LoadAgentDefsResult,
	availableServers: string[],
): LoadAgentDefsResult {
	if (availableServers.length === 0 && loaded.agents.every((a) => readRequiredMcpServers(a.def).length === 0)) {
		return loaded;
	}
	const agents: LoadedAgentDef[] = [];
	const diagnostics = [...loaded.diagnostics];
	for (const a of loaded.agents) {
		if (agentMcpRequirementsMet(a.def, availableServers)) {
			agents.push(a);
		} else {
			diagnostics.push({
				type: "warning",
				path: a.def.filePath,
				message: `agent "${a.def.name}" hidden — missing required MCP servers: ${readRequiredMcpServers(a.def).join(", ")}`,
			});
		}
	}
	return { agents, diagnostics };
}
