// Imports the leaf `tool-names.ts` (no runtime deps) — NOT `tools/index.ts` — so there
// is no circular import and these can be built eagerly at module load.
import { DYNAMIC_TOOL_PREFIXES, VALID_TOOL_NAMES } from "../tools/tool-names.js";

const KNOWN = new Set<string>(VALID_TOOL_NAMES);
const KNOWN_LOWER = new Map<string, string>(VALID_TOOL_NAMES.map((n) => [n.toLowerCase(), n]));

/**
 * Cross-platform tool-name aliases (#59 stage 2). Maps Claude-Code-cased
 * tool names in agent frontmatter (the convention CC personas use) to cave's
 * canonical lowercase names so a persona authored for CC works in cave
 * without manual edits.
 *
 * Compatibility caveats (council BLOCKER — see #59):
 *   - `Read → read`: cave's `read` produces line-numbered output similar to
 *     CC's `Read`; both accept `path`, `offset`, `limit`. Output annotations
 *     differ slightly. Personas should not rely on exact whitespace/markers.
 *   - `Bash → bash`: cave's `bash` executes shell commands. Output format
 *     matches CC's `Bash` closely; truncation/timeout semantics differ.
 *   - `Edit → edit`: parameter shape is similar; cave validates stricter
 *     `path`/`oldText`/`newText`. Personas using regex-style replacements may
 *     break.
 *   - `Write → write`: identical contract.
 *   - `Grep → grep`: cave's `grep` is content search. CC's `Grep` is the same.
 *   - `LS → ls`: directory listing; equivalent.
 *   - `Glob → grep, find`: CC's `Glob` mixes filename pattern + content; cave
 *     splits into `grep` (content) and `find` (filename). One-to-many alias.
 *
 * Personas that reference exact tool output (e.g. "the file content shown above
 * with line numbers") may behave differently after aliasing. Cave emits a
 * per-persona diagnostic when aliasing fires so the user can verify behavior.
 */
const CC_TOOL_ALIASES: Record<string, string[]> = {
	Read: ["read"],
	Bash: ["bash"],
	Edit: ["edit"],
	Write: ["write"],
	Grep: ["grep"],
	LS: ["ls"],
	Glob: ["grep", "find"],
};

export interface AliasResult {
	/** Canonical tool names after alias rewrite (with duplicates removed, order preserved). */
	canonical: string[];
	/** Aliases that fired this rewrite. Each entry is `<original> → <canonical1>[,<canonical2>]`. */
	aliasesApplied: string[];
}

/**
 * Rewrite an agent's `tools:` frontmatter list to use cave's canonical tool
 * names, mapping known CC-cased aliases. Unknown names pass through unchanged
 * (they're separately classified by `classifyToolName`). One-to-many aliases
 * expand inline; duplicates are de-duplicated while preserving first-seen order.
 */
export function aliasCcToolNames(tools: readonly string[]): AliasResult {
	const canonical: string[] = [];
	const seen = new Set<string>();
	const aliasesApplied: string[] = [];
	for (const name of tools) {
		const aliases = CC_TOOL_ALIASES[name];
		if (aliases) {
			aliasesApplied.push(`${name} → ${aliases.join(", ")}`);
			for (const a of aliases) {
				if (!seen.has(a)) {
					seen.add(a);
					canonical.push(a);
				}
			}
		} else {
			if (!seen.has(name)) {
				seen.add(name);
				canonical.push(name);
			}
		}
	}
	return { canonical, aliasesApplied };
}

export type ToolNameIssue =
	| { kind: "did-you-mean"; name: string; suggestion: string }
	| { kind: "unknown"; name: string };

/** A dynamic tool reference: a prefix PLUS a non-empty name segment (e.g. `mcp__fs__read`).
 *  A bare prefix (`mcp__`, `memory_`) is not a real tool and is not exempted. */
function isDynamicToolName(name: string): boolean {
	return DYNAMIC_TOOL_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length);
}

/** Classify one tool name. null = ok (known or plausibly-dynamic). */
export function classifyToolName(name: string): ToolNameIssue | null {
	if (KNOWN.has(name)) return null;
	if (isDynamicToolName(name)) return null;
	const ci = KNOWN_LOWER.get(name.toLowerCase());
	if (ci) return { kind: "did-you-mean", name, suggestion: ci };
	return { kind: "unknown", name };
}

const WRITE_TOOLS = ["edit", "write"] as const; // bash EXCLUDED — superset, reads via shell
const LOCATE_TOOLS = ["read", "grep", "ls", "find"] as const;

/** True when the agent can mutate files but has no tool to locate/inspect them first.
 *  Pass the EFFECTIVE set (tools minus disallowedTools) — see caller. A dynamic tool
 *  (mcp__ or memory_ prefixed) may itself be a reader, so its presence suppresses the warning. */
export function isIncompleteWriteSet(effectiveTools: readonly string[]): boolean {
	const set = new Set(effectiveTools);
	const canWrite = WRITE_TOOLS.some((t) => set.has(t));
	const canLocate = LOCATE_TOOLS.some((t) => set.has(t));
	const hasDynamic = effectiveTools.some(isDynamicToolName);
	return canWrite && !canLocate && !set.has("bash") && !hasDynamic;
}

/** tools minus disallowedTools — what the child actually receives (task.ts:210-213). */
export function effectiveTools(tools: readonly string[], disallowed: readonly string[] = []): string[] {
	const blocked = new Set(disallowed);
	return tools.filter((t) => !blocked.has(t));
}
