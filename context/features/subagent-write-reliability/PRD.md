# PRD — Reliable Subagent Write Capability (issue #30)

**Priority:** P2 · **Effort:** S · **Owner:** mewrite-code · **Status:** draft → council

## 1. Problem

Subagents **can** already write — `tools: edit, write` in an agent `.md` flows through to the child on both dispatch paths (`task.ts:210` foreground, `:371` background); `agents/implementer.md` proves it. But `tools:` is an unvalidated allow-list, so enabling write **silently breaks** in three ways, and there's no easy on-ramp:

1. **Misspelled / wrong-case tool names are dropped silently.** Real names are lowercase `edit`/`write`/`bash`/`read`/… (`tools/index.ts:167 allTools`). Frontmatter `tools: Write` / `editor` / `str_replace` passes the loader's type-only check (`subagent.ts:195` validates array-ness, not names), the child gets `--tools Write`, registers nothing matching, and the agent can't write — with no error.
2. **Write agent with no way to locate files.** `edit` reads the target internally (it does *not* require the `read` tool), but an agent given `tools: edit, write` and nothing to search/list (`read`/`grep`/`ls`/`find`) can't find or inspect the file it's meant to change. No warning.
3. **Plan-mode silently disables writes.** `edit`/`write` aren't in `PLAN_MODE_TOOL_ALLOWLIST` (`chat-modes/plan.ts:17`). A write-capable agent dispatched under plan mode (`modeOverride: "plan"`, `task.ts:556`) is forced read-only — invisibly, so it looks like the capability is broken.
4. **No bundled write-in-place agent.** Every bundled agent except `implementer` is read-only, and `implementer` is worktree-isolated + plan-shaped. A user who just wants "an agent that edits files in the current tree" has no template.

## 2. Goal

Enabling subagent writes is reliable and legible: a misspelled or incomplete tool list is **surfaced, not silently dropped**; plan-mode suppression is **observable**; and a bundled write-in-place agent + docs give a copy-paste on-ramp. No change to the existing write path (it works) — this is validation + observability + a template.

## 3. Non-Goals

- No new permission system (autopilot stays; Me Write Code has no permission tier).
- No change to how `--tools` is passed to the child, or to plan-mode's allow-list.
- Not hard-failing on unknown tool names — MCP (`mcp__server__tool`), memory (`memory_search`/`memory_save`), and skill-injected tool names are dynamic and legitimately absent from the static registry. Validation is **warn-only**.

## 4. Proposed Solution

### 4.1 Export the canonical tool-name set
Export `VALID_TOOL_NAMES` (= `Object.keys(allTools)`, plus the memory tool names) from `packages/coding-agent/src/core/tools/index.ts` so the loader can validate against the source of truth.

### 4.2 Validate `tools` / `disallowedTools` names in the loader (warn-only)
In `agent-defs/loader.ts` (which owns the `ResourceDiagnostic` channel — `packages/agent` must NOT import the coding-agent tool registry), after `validateSubagentDef`, for each name in `tools`/`disallowedTools`:
- Known built-in → ok.
- Matches `mcp__*` prefix, or is otherwise plausibly dynamic → skip (no warning).
- Case-insensitive match to a known name (e.g. `Write`→`write`, `LS`→`ls`) → **warning** with a "did you mean `<name>`?" hint.
- Otherwise unknown → **warning** ("not a known built-in tool; if this is an MCP/skill tool, ignore").

### 4.3 Incomplete-write-set warning
If `tools` includes any write-capable tool (`edit`/`write`/`bash`) but none of `read`/`grep`/`ls`/`find`, emit a warning: the agent can mutate files but can't locate or inspect them first.

### 4.4 Observable plan-mode suppression
When a subagent that declares write-capable tools is dispatched under plan mode (`modeOverride: "plan"` or inherited plan mode), surface a one-line note in the subagent's run header/progress ("plan mode — write tools suppressed") so it's not mistaken for a broken capability.

### 4.5 Bundled write-in-place agent + docs
Ship `packages/coding-agent/agents/editor.md` — **non-isolated**, `tools: read, grep, find, ls, edit, write` — as the canonical edit-in-the-current-tree template. Document the minimal write toolset (and the worktree-vs-in-place trade-off) in `docs/reference/subagents.md`.

## 5. Success Metrics

- **Primary:** an agent `.md` with a misspelled write tool produces a visible diagnostic at load (not a silent no-op).
- **Secondary:** users have a documented, bundled write-capable agent to copy.
- **Guardrail:** zero false-positive warnings on agents using MCP/skill/memory tool names; no change to working agents (`implementer`, read-only bundled agents) or the dispatch path.

## 6. Risks

- **False positives** on dynamic tool names (MCP/skill/memory) → noisy, erodes trust in diagnostics. Mitigate: warn-only + skip `mcp__*` + include memory tools in the known set + soft wording.
- **Validation-home coupling**: must stay in the loader, not `packages/agent` (dependency direction). 
- **Plan-mode note plumbing**: the subagent run-header path must carry the note without churn to the progress event shape.

## 7. Definition of Done

- `VALID_TOOL_NAMES` exported from the tool registry; loader validates `tools`/`disallowedTools` names, warn-only, with did-you-mean for case/typo and an MCP/skill escape hatch.
- Incomplete-write-set warning fires for write-without-locate.
- Plan-mode write suppression is surfaced in the subagent run output.
- Bundled `editor.md` agent exists + is documented; dispatching it edits a file in the parent cwd.
- Tests green (vitest + node:test), root `tsgo --noEmit` clean, biome clean.
