# Subagent Write Reliability — Implementation Plan (issue #30)

> **For agentic workers:** TDD. Test first, run-fail, implement, run-pass, commit. vitest for packages/coding-agent; node:test for tui (n/a here). biome, tsgo strict. Revert `packages/ai/src/models.generated.ts` + `package-lock.json` before every commit. Commit signed (`-S`). Stage by explicit path.

**Goal:** Make enabling subagent writes legible — validate the `tools`/`disallowedTools` allow-list (warn, not silent-drop), warn on a write set that can't locate files, and ship a documented in-place `editor` agent.

**Architecture:** Pure validation helper (`agent-defs/tool-name-check.ts`) over the canonical `VALID_TOOL_NAMES` (= `Object.keys(allTools)`); loader emits warnings via its existing `ResourceDiagnostic` channel; new bundled `editor.md`. No dispatch-path change (plan-mode note + element-type guard were cut — see DD §7).

---

## Chunk A: tool-name validation helper

**Files:**
- Modify: `packages/coding-agent/src/core/tools/index.ts` (export `VALID_TOOL_NAMES`, `DYNAMIC_TOOL_PREFIXES`)
- Create: `packages/coding-agent/src/core/agent-defs/tool-name-check.ts`
- Test: `packages/coding-agent/src/core/agent-defs/__tests__/tool-name-check.test.ts` (or repo's test dir convention — match neighbors)

- [ ] **A1. Failing test:** write `tool-name-check.test.ts` per DD §5 (classifyToolName: write→null, Write→did-you-mean write, LS→ls, mcp__x__y→null, memory_save→null, wirte→unknown, str_replace→unknown; isIncompleteWriteSet: [edit,write]→true, [edit,read]→false, [bash]→false, [write,grep]→false, [bash,write]→false, []→false; effectiveTools: (["read","edit"],["read"])→["edit"]). Run → FAIL (module absent).
- [ ] **A2.** Add exports to `tools/index.ts` after `allTools`/`type ToolName`: `VALID_TOOL_NAMES = Object.keys(allTools)`, `DYNAMIC_TOOL_PREFIXES = ["mcp__","memory_"]`.
- [ ] **A3.** Implement `tool-name-check.ts` (classifyToolName, isIncompleteWriteSet, effectiveTools) per DD §2. Run A1 → PASS. `npx tsgo --noEmit` → clean.
- [ ] **A4. Commit:** `feat(agents): tool-name validation helper for agent tools allow-list`

## Chunk B: loader wiring + diagnostics

**Files:**
- Modify: `packages/coding-agent/src/core/agent-defs/loader.ts` (parseAgentDefFile)
- Test: `packages/coding-agent/test/agent-defs-loader.test.ts` (extend; use existing `writeAgent()` + `parseAgentDefFile`)

- [ ] **B1. Failing test:** in `agent-defs-loader.test.ts`, mirror the existing fixture pattern (~lines 52-118): an agent with `tools: ["Write","bogus"]` + `disallowedTools: ["Bahs"]` → assert `diagnostics` contains warnings (did-you-mean write; unknown bogus; disallowedTools won't-block); an agent `tools: ["memory_save","mcp__x__y"]` → no tool-name warnings; an agent `tools: ["edit","write"]` → incomplete-write warning. Run → FAIL.
- [ ] **B2.** Wire into `parseAgentDefFile` after `validateSubagentDef` (DD §3): loop `tools` + `disallowedTools` through `classifyToolName`, push warnings to the local `diagnostics` array; compute `effectiveTools` + `isIncompleteWriteSet` → push warning. Import from `tool-name-check.js` + `VALID_TOOL_NAMES`. Run B1 → PASS. `tsgo` clean.
- [ ] **B3.** Confirm warnings (not errors) — `reportDiagnostics` (main.ts) must not exit>0 on these. Verify no existing agent-defs-loader test regresses (bundled agents stay warning-free). Run full `agent-defs-loader.test.ts` → green.
- [ ] **B4. Commit:** `feat(agents): warn on unknown/typo agent tool names + locate-less write sets`

## Chunk C: bundled editor agent + docs

**Files:**
- Create: `packages/coding-agent/agents/editor.md`
- Modify: `docs/reference/subagents.md`
- Test: extend a bundled-agents test (or B1's file) asserting editor.md parses

- [ ] **C1. Failing test:** assert `loadAgentDefs` (or `parseAgentDefFile` on the bundled path) yields an `editor` agent with tools including edit+write+read and no `isolation` field (in-place default). Run → FAIL.
- [ ] **C2.** Create `editor.md` per DD §4 (tools: read, grep, find, ls, edit, write; tight description; no isolation; frontmatter comment on worktree opt-in; body rules). Run C1 → PASS.
- [ ] **C3.** Docs: add `editor` to the bundled-agents list in `docs/reference/subagents.md`; document minimal write toolset, in-place-vs-worktree trade-off, and the `task`-omission-prevents-fan-out note.
- [ ] **C4. Commit:** `feat(agents): bundle in-place editor agent + document write capability`

## Chunk D: verification
- [ ] **D1.** `git checkout -- packages/ai/src/models.generated.ts package-lock.json`
- [ ] **D2.** Root `npx tsgo --noEmit` → clean (incl. tests).
- [ ] **D3.** `npm test -w @zhachory1/mewrite-code` → green (loader + helper tests).
- [ ] **D4.** `npx biome check --error-on-warnings` on touched files → clean.
- [ ] **D5.** Confirm models.generated.ts / package-lock.json not staged.
