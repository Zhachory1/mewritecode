# DD — Reliable Subagent Write Capability (issue #30)

**Status:** PRD-council unanimous SHIP-WITH-CHANGES; DD-council SPLIT (red-team BLOCK — but its blockers were refuted in code or cut). All resolutions below are post-DD-review and authoritative. Ready for plan.

## 0. Resolutions (authoritative — supersede any earlier draft)

1. `VALID_TOOL_NAMES = Object.keys(allTools)` (12 names). **Verified**: the child accepts exactly `name in allTools` (`args.ts:118`), so all 12 are valid/non-dropped — keep them all (no meta-tool carve-out). Dynamic tools handled by prefix-escape.
2. Validator: known set + `mcp__*`/`memory_*` prefix skip; case-insensitive → "did you mean"; else → "unknown, check spelling". No fuzzy.
3. Validate `disallowedTools` names too; "won't block anything" message. Warn-only.
4. `isIncompleteWriteSet` runs on the **effective set** (`tools` minus `disallowedTools`), excludes `bash` (superset). Fire only when `edit`/`write` present, no locate tool, and no `bash`.
5. **`editor.md` ships `isolation: none` (in-place)** — issue #30 asked for in-place, and cavecode is deliberately autopilot/no-permission (the main loop already edits in-place ungated; an editor subagent is not a new risk class). Mis-dispatch is mitigated by a **tight description** ("apply a specific, already-decided edit"). `isolation: worktree` is the documented opt-in for when an isolated/reviewable change is wanted. (Worktree edits are NOT discarded — `autoCleanupWorktree` keeps dirty worktrees — but they require a manual merge, which is friction for the common "just make this edit" case.)
6. **§5 plan-mode suppression note is CUT.** `task`/`agent` are not in `PLAN_MODE_TOOL_ALLOWLIST` (`chat-modes/plan.ts:17`), so a plan-mode parent cannot dispatch subagents at all — the note would be unreachable. No `shouldNotePlanSuppression`, no `task.ts` change.
7. **Element-type guard DROPPED.** `normalizeFrontmatterArray` (`subagent.ts:213`) does `String(v).trim()` before validation, so `tools: [42]` → `["42"]` → handled by the name validator as an "unknown tool" warning. The guard would be dead for `.md` inputs; the name validator covers it gracefully.

## 1. Tool-name source of truth (packages/coding-agent/src/core/tools/index.ts)

After `allTools` (`:167`) + `type ToolName` (`:197`), export:

```ts
/** Canonical built-in tool names — exactly the set the child CLI accepts (`name in allTools`, args.ts:118).
 *  Source of truth for agent `tools:` validation. Dynamic tools (memory_*, mcp__*, skill) are NOT here. */
export const VALID_TOOL_NAMES: readonly string[] = Object.keys(allTools);

/** Prefixes for tools registered at runtime (memory layer, MCP servers). A name with one of these
 *  is plausibly real and must NOT be warned about. */
export const DYNAMIC_TOOL_PREFIXES: readonly string[] = ["mcp__", "memory_"];
```

## 2. Validation helper (packages/coding-agent/src/core/agent-defs/tool-name-check.ts) — pure, unit-tested

```ts
import { DYNAMIC_TOOL_PREFIXES, VALID_TOOL_NAMES } from "../tools/index.js";

const KNOWN = new Set(VALID_TOOL_NAMES);
const KNOWN_LOWER = new Map(VALID_TOOL_NAMES.map((n) => [n.toLowerCase(), n]));

export type ToolNameIssue =
	| { kind: "did-you-mean"; name: string; suggestion: string }
	| { kind: "unknown"; name: string };

/** Classify one tool name. null = ok (known or plausibly-dynamic). */
export function classifyToolName(name: string): ToolNameIssue | null {
	if (KNOWN.has(name)) return null;
	if (DYNAMIC_TOOL_PREFIXES.some((p) => name.startsWith(p))) return null;
	const ci = KNOWN_LOWER.get(name.toLowerCase());
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
```

## 3. Loader wiring (packages/coding-agent/src/core/agent-defs/loader.ts)

In `parseAgentDefFile` (~`:80-163`), after `validateSubagentDef` (`:148`), push to the **local `diagnostics` array already in that function** (mirror its existing `diagnostics.push` at ~`:149-151` — NOT the MCP-filter at `:330`, which is a different phase):

```ts
for (const name of def.tools ?? []) {
	const issue = classifyToolName(name);
	if (issue?.kind === "did-you-mean")
		diagnostics.push({ type: "warning", path: filePath,
			message: `agent "${def.name}": tool "${name}" — did you mean "${issue.suggestion}"? (dropped as-is)` });
	else if (issue?.kind === "unknown")
		diagnostics.push({ type: "warning", path: filePath,
			message: `agent "${def.name}": unknown tool "${name}" — check spelling; it will be silently dropped. Known: ${VALID_TOOL_NAMES.join(", ")}` });
}
for (const name of def.disallowedTools ?? []) {
	const issue = classifyToolName(name);
	if (issue)
		diagnostics.push({ type: "warning", path: filePath,
			message: `agent "${def.name}": disallowedTools "${name}" matches no known tool — it won't block anything${issue.kind === "did-you-mean" ? ` (did you mean "${issue.suggestion}"?)` : ""}.` });
}
const eff = effectiveTools(def.tools ?? [], def.disallowedTools ?? []);
if (isIncompleteWriteSet(eff))
	diagnostics.push({ type: "warning", path: filePath,
		message: `agent "${def.name}": has edit/write but no read/grep/ls/find — it can mutate files but cannot locate or inspect them first.` });
```

## 4. Bundled editor agent (packages/coding-agent/agents/editor.md)

```markdown
---
name: editor
description: Apply a specific, already-decided edit to named files in the working tree. Not for exploration or open-ended tasks.
tools: read, grep, find, ls, edit, write
model: claude-sonnet-4-5
effort: medium
maxTurns: 20
# Edits land IN the working tree (no isolation), matching cave's autopilot model.
# For an isolated, reviewable change set instead, set `isolation: worktree` — edits
# then live in a fresh git worktree you merge yourself (see implementer.md).
---

You are **Editor**. Apply the requested change precisely and minimally.

## Rules
1. Read the target before editing; make the smallest change that satisfies the request.
2. You edit the working tree directly — do not git commit or push.
3. State what you changed, with `path:line` refs.
4. If the request is exploratory or ambiguous, say so and stop — you are for concrete edits, not investigation.
```

Docs (`docs/reference/subagents.md`): document the minimal write toolset (`read, grep, find, ls, edit, write`), the in-place-vs-worktree trade-off, and that **omitting `task` from `tools:` prevents the agent from spawning subagents** (intentional for editor/implementer).

## 5. Test plan

**packages/coding-agent (vitest)** — `agent-defs/tool-name-check.test.ts` (pure):
- `classifyToolName`: `write`→null; `Write`→did-you-mean `write`; `LS`→`ls`; `mcp__x__y`→null; `memory_save`→null; `wirte`→unknown; `str_replace`→unknown.
- `isIncompleteWriteSet`: `[edit,write]`→true; `[edit,read]`→false; `[bash]`→false; `[write,grep]`→false; `[bash,write]`→false; `[]`→false.
- `effectiveTools`: `(["read","edit"],["read"])`→`["edit"]`; then `isIncompleteWriteSet(["edit"])`→true (catches the disallow-defeats-locate case).

**Loader test** — extend `packages/coding-agent/test/agent-defs-loader.test.ts` using its existing `writeAgent()` helper + the exported `parseAgentDefFile` (mirror the pattern ~lines 52-118): a fixture with `tools: [Write, bogus]` + `disallowedTools: [Bahs]` yields the expected **warning** diagnostics (not errors); `tools: [memory_save, mcp__x__y]` yields none; an `edit,write`-only agent yields the incomplete-write warning.

**Bundled agent** — assert `editor.md` parses, has edit+write+read, and (by current resolution) no `isolation` field (defaults to in-place).

## 6. Definition of Done
- `VALID_TOOL_NAMES`/`DYNAMIC_TOOL_PREFIXES` exported; `classifyToolName`/`isIncompleteWriteSet`/`effectiveTools` pure + tested.
- Loader warns (never errors) on bad `tools`/`disallowedTools` names + incomplete effective-write set; zero false positives on memory/MCP names.
- `disallowedTools` typo → "won't block anything" warning.
- `editor.md` bundled (in-place, tight description) + documented (incl. worktree opt-in + `task`-omission note).
- vitest + node:test green, root `tsgo --noEmit` clean, biome clean.

## 7. Cut from scope (with reason)
- **Plan-mode suppression note**: unreachable — `task`/`agent` excluded from `PLAN_MODE_TOOL_ALLOWLIST` (`plan.ts:17`), so subagents can't be dispatched from plan mode. No code.
- **Element-type guard in `validateSubagentDef`**: dead for `.md` inputs — `normalizeFrontmatterArray` (`subagent.ts:213`) coerces to strings first; the name validator surfaces the coerced value as an "unknown tool" warning.
