/**
 * Subagent runtime — types, parallel cap, and tool-scoping helper.
 *
 * Public surface:
 *   - SubagentDef                     — the canonical subagent definition,
 *                                       parsed from `.cave/agents/<name>.md`
 *                                       frontmatter (plus body = system prompt).
 *   - SubagentResult                  — schema-light envelope returned by a
 *                                       single subagent invocation.
 *   - MAX_PARALLEL_SUBAGENTS          — 7 (per plan §6).
 *   - validateSubagentDef             — runtime validation of a parsed def.
 *
 * Design notes:
 *   - Types live in @juliusbrussee/caveman-agent so the loader (in @juliusbrussee/caveman-coding-agent) and the
 *     Task/Agent tools (also in coding-agent) can both import them without a
 *     circular dependency.
 *   - MAX_PARALLEL_SUBAGENTS=7 mirrors Claude Code's documented Task fan-out
 *     limit (plan §6).
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// ─── Isolation strategy ────────────────────────────────────────────────────

/**
 * `worktree`  — spawn the subagent inside `git worktree add .cave/worktrees/<id> <branch>`
 *               so its writes never collide with the parent session.
 * `none`      — share parent cwd. Cheaper, but every Edit/Write hits the same tree.
 */
export type SubagentIsolation = "worktree" | "none";

// ─── Subagent definition (parsed from `.cave/agents/<name>.md`) ────────────

/**
 * Frontmatter superset of Claude Code v2.1.119's agent format.
 *
 * Required: `description`. All others are optional. A user pasting
 * `~/.claude/agents/foo.md` into `~/.cave/agents/foo.md` MUST work unchanged
 * — we only ADD fields, never rename or shadow CC ones.
 */
export interface SubagentDef {
	/** Stable identifier (filename without `.md`, validated to lowercase a-z, 0-9, hyphens). */
	name: string;
	/** Short selector hint shown to the model when picking an agent. */
	description: string;
	/**
	 * Body of the markdown file = system prompt. Read on demand by the runner;
	 * the loader stores it inline so callers do not have to re-read disk.
	 */
	prompt: string;

	// ── Tool-scoping (CC-compatible) ───────────────────────────────────────

	/** Comma-separated list of tools the agent may call. Undefined = inherit parent. */
	tools?: string[];
	/** Tools explicitly forbidden. Applied AFTER `tools`. */
	disallowedTools?: string[];

	// ── Model + effort ────────────────────────────────────────────────────

	model?: string;
	effort?: "low" | "medium" | "high" | string;

	// ── Isolation ─────────────────────────────────────────────────────────

	isolation?: SubagentIsolation;

	// ── Tooling integration ───────────────────────────────────────────────

	/** Names of MCP servers to surface to this agent. */
	mcpServers?: string[];
	/**
	 * MCP server name patterns that MUST be configured for this agent to be
	 * eligible for selection. When any pattern is missing, the loader marks the
	 * agent unavailable and the Task tool hides it from the model.
	 * Reference: claude-code loadAgentsDir.ts:229-242.
	 */
	requiredMcpServers?: string[];
	/** Skill names to auto-attach for this agent. */
	skills?: string[];
	/**
	 * When true, the bundled CLAUDE.md hierarchy is NOT loaded into the
	 * subagent system prompt. Use for read-only specialists (explore, critic,
	 * reviewer) where project context is unnecessary noise.
	 * Reference: claude-code loadAgentsDir.ts:128-131 (5-15 Gtok/wk savings).
	 */
	omitClaudeMd?: boolean;
	/** Hook event-to-command map; same schema as settings.json hooks. */
	hooks?: Record<string, unknown>;

	// ── Loop controls ─────────────────────────────────────────────────────

	/** Hard cap on agent loop iterations. */
	maxTurns?: number;
	/** Run in background (don't block the parent agent). */
	background?: boolean;

	// ── Provenance ────────────────────────────────────────────────────────

	/** Where this def came from (project, user, plugin, builtin). */
	source: SubagentSource;
	/** Absolute path to the .md file. */
	filePath: string;

	/** Unknown frontmatter keys passed through verbatim (e.g. CC-only fields cave doesn't yet wire). */
	[key: string]: unknown;
}

export type SubagentSource = "project" | "user" | "builtin" | "plugin";

// ─── Result envelope ───────────────────────────────────────────────────────

export interface SubagentResult {
	/** Name of the agent that ran. */
	agent: string;
	/** Origin of the agent definition. */
	source: SubagentSource;
	/** Task as passed to the agent (post-substitution). */
	task: string;
	/** Final assistant text from the subagent loop. */
	output: string;
	/** True when the inline tool response is a preview and callers should read fullOutputPath. */
	truncated?: boolean;
	/** Durable file containing the full final assistant text. */
	fullOutputPath?: string;
	/** Durable JSONL stdout stream from the child process. */
	stdoutPath?: string;
	/** Durable stderr stream from the child process. */
	stderrPath?: string;
	/** UTF-8 byte length of output. */
	outputBytes?: number;
	/** Exit code: 0 = success, >0 = failure, -1 = still running. */
	exitCode: number;
	/** Optional structured payload (free-form for now; schema-validated in P1). */
	data?: unknown;
	/** Error message if the agent stopped abnormally. */
	error?: string;
	/** Token usage, mirrors pi-ai's accounting. */
	usage?: SubagentUsage;
	/** Worktree dir if isolation:worktree was applied. */
	worktreeDir?: string;
	/** Branch name if isolation:worktree was applied. */
	branchName?: string;
	/** Whether the worktree was auto-cleaned (worktree mode only). */
	worktreeCleaned?: boolean;
}

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

// ─── Parallel cap (per plan §6: "up to 7 parallel via Task") ──────────────

export const MAX_PARALLEL_SUBAGENTS = 7;

// ─── Validation ─────────────────────────────────────────────────────────

const VALID_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Validate a parsed subagent definition. Returns array of error strings
 * (empty = valid). Used by the loader to emit ResourceDiagnostics and by the
 * Task/Agent tools to fail-fast on bad invocations.
 */
export function validateSubagentDef(def: Partial<SubagentDef>): string[] {
	const errors: string[] = [];

	if (!def.name || typeof def.name !== "string") {
		errors.push("name is required");
	} else {
		if (def.name.length > 64) errors.push(`name exceeds 64 characters (${def.name.length})`);
		if (!VALID_NAME.test(def.name)) {
			errors.push(
				`name "${def.name}" contains invalid characters (must be lowercase a-z, 0-9, hyphens; no leading/trailing hyphen)`,
			);
		}
	}

	if (!def.description || typeof def.description !== "string" || def.description.trim() === "") {
		errors.push("description is required");
	} else if (def.description.length > 1024) {
		errors.push(`description exceeds 1024 characters (${def.description.length})`);
	}

	if (!def.prompt || typeof def.prompt !== "string") {
		errors.push("prompt body is required (markdown file body after frontmatter)");
	}

	if (def.isolation !== undefined && def.isolation !== "worktree" && def.isolation !== "none") {
		errors.push(`isolation "${def.isolation}" must be "worktree" or "none"`);
	}

	if (def.maxTurns !== undefined) {
		if (typeof def.maxTurns !== "number" || def.maxTurns <= 0 || !Number.isFinite(def.maxTurns)) {
			errors.push("maxTurns must be a positive finite number");
		}
	}

	if (def.tools !== undefined && !Array.isArray(def.tools)) {
		errors.push("tools must be an array of tool names");
	}

	if (def.disallowedTools !== undefined && !Array.isArray(def.disallowedTools)) {
		errors.push("disallowedTools must be an array of tool names");
	}

	return errors;
}

/**
 * Normalize the subset of frontmatter fields whose CC schema accepts both
 * comma-strings and arrays. Accepting both makes copy-paste from
 * `~/.claude/agents/` always work.
 */
export function normalizeFrontmatterArray(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return undefined;
}

// ─── Task tool params (shared schema shape) ──────────────────────────────

/**
 * Schema-light shape returned by the Task tool. The actual TypeBox schema
 * is declared in `@juliusbrussee/caveman-coding-agent`'s task.ts so it can use the same
 * project's TypeBox version; we keep the TS shape here for type sharing.
 */
export interface TaskInvocation {
	/** Agent name (must exist in the loaded agent registry). */
	agent: string;
	/** Task description handed to the agent (becomes the user message). */
	task: string;
	/** Optional override for cwd. Defaults to parent session cwd or worktree. */
	cwd?: string;
}

/** Shape used by the Task tool's `parallel` mode. */
export interface ParallelTaskParams {
	tasks: TaskInvocation[];
}

/** Shape used by the Task tool's `chain` mode (output → next task as `{previous}`). */
export interface ChainTaskParams {
	chain: TaskInvocation[];
}

/** Schema input passed by the runtime when running a single subagent. */
export interface RunSubagentInput {
	def: SubagentDef;
	task: string;
	cwd: string;
	signal?: AbortSignal;
}

/**
 * Compute the effective tool allowlist for a subagent given the parent tool
 * registry plus the subagent's `tools` / `disallowedTools` frontmatter.
 */
export function computeAllowedTools(args: {
	parentTools: string[];
	frontmatterTools?: string[];
	frontmatterDisallowed?: string[];
}): string[] {
	let pool = args.frontmatterTools && args.frontmatterTools.length > 0 ? args.frontmatterTools : args.parentTools;
	if (args.frontmatterDisallowed && args.frontmatterDisallowed.length > 0) {
		const block = new Set(args.frontmatterDisallowed);
		pool = pool.filter((t) => !block.has(t));
	}
	return pool;
}

// ─── Re-export-friendly typing -------------------------------------------

export type SubagentDefMaybe = SubagentDef | undefined;

/** Best-effort lookup helper used by Task/Agent tools and tests. */
export function findSubagent(defs: SubagentDef[], name: string): SubagentDef | undefined {
	return defs.find((d) => d.name === name);
}

// ─── Result-schema stub (P1) ─────────────────────────────────────────────

/**
 * Validate `SubagentResult.data` against the optional `outputSchema` declared
 * on a `SubagentDef` (TypeBox). When the def carries no schema this returns
 * `{ ok: true }`. The runtime calls this from the Task tool after a subagent
 * completes — invalid output is surfaced as an error tool result so the
 * parent session can decide whether to retry with a clarifying message.
 */
export interface SubagentDefWithOutputSchema extends SubagentDef {
	outputSchema?: TSchema;
}

export function validateSubagentOutput(
	def: SubagentDef,
	data: unknown,
): { ok: true } | { ok: false; errors: string[] } {
	const schema = (def as SubagentDefWithOutputSchema).outputSchema;
	if (!schema) return { ok: true };

	if (Value.Check(schema, data)) return { ok: true };

	const errors = [...Value.Errors(schema, data)].slice(0, 10).map((err) => {
		const path = err.path || "/";
		return `${path}: ${err.message} (got: ${JSON.stringify(err.value)?.slice(0, 80)})`;
	});
	return { ok: false, errors };
}
