import { DYNAMIC_TOOL_PREFIXES, VALID_TOOL_NAMES } from "../tools/index.js";

// Lazily memoized — NOT computed at module top level. `tools/index.ts` pulls the
// whole tool runtime, so loader → tool-name-check → tools/index is a circular
// import; reading VALID_TOOL_NAMES at eval time would see `undefined` mid-cycle
// (TypeError: ...map of undefined). Deferring to first call sidesteps the cycle.
let _known: Set<string> | undefined;
let _knownLower: Map<string, string> | undefined;
function known(): Set<string> {
	if (!_known) _known = new Set(VALID_TOOL_NAMES);
	return _known;
}
function knownLower(): Map<string, string> {
	if (!_knownLower) _knownLower = new Map(VALID_TOOL_NAMES.map((n) => [n.toLowerCase(), n]));
	return _knownLower;
}

export type ToolNameIssue =
	| { kind: "did-you-mean"; name: string; suggestion: string }
	| { kind: "unknown"; name: string };

/** Classify one tool name. null = ok (known or plausibly-dynamic). */
export function classifyToolName(name: string): ToolNameIssue | null {
	if (known().has(name)) return null;
	if (DYNAMIC_TOOL_PREFIXES.some((p) => name.startsWith(p))) return null;
	const ci = knownLower().get(name.toLowerCase());
	if (ci) return { kind: "did-you-mean", name, suggestion: ci };
	return { kind: "unknown", name };
}

const WRITE_TOOLS = ["edit", "write"] as const; // bash EXCLUDED — superset, reads via shell
const LOCATE_TOOLS = ["read", "grep", "ls", "find"] as const;

/** True when the agent can mutate files but has no tool to locate/inspect them first.
 *  Pass the EFFECTIVE set (tools minus disallowedTools) — see caller. */
export function isIncompleteWriteSet(effectiveTools: readonly string[]): boolean {
	const set = new Set(effectiveTools);
	const canWrite = WRITE_TOOLS.some((t) => set.has(t));
	const canLocate = LOCATE_TOOLS.some((t) => set.has(t));
	return canWrite && !canLocate && !set.has("bash");
}

/** tools minus disallowedTools — what the child actually receives (task.ts:210-213). */
export function effectiveTools(tools: readonly string[], disallowed: readonly string[] = []): string[] {
	const blocked = new Set(disallowed);
	return tools.filter((t) => !blocked.has(t));
}
