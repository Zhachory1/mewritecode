# Design Doc: Session Activity Monitor

- Status: reviewed → revised (v2 scope below supersedes conflicting earlier sections)
- Author: Zhach Volker
- Date: 2026-06-12
- Implements: [PRD.md](./PRD.md)

> **READ THE ADDENDUM FIRST (§11).** Three independent reviews (eng, UX, skeptical) found that several v1 goals as first drafted rest on data not in the event stream (nested/background subagent trees), on id correlations that don't exist (`subagent_progress` ≠ `toolCallId`), and on a model-row lifetime that breaks the blocker highlight. §11 is the authoritative, buildable v1 design. Sections 3–9 are kept for context/history; where they conflict with §11, §11 wins.

## 1. Summary

Add one session-scoped `ActivityRegistry` that records every concurrent activity the session has in flight — the model request, each tool execution, subagents (incl. nested/background), and bash child processes — each with a start timestamp, status, parent, and optional detail. Feed it from the existing `AgentEvent`/`AgentSessionEvent` stream (plus two thin hooks for bash PID and subagent current-tool). Rebuild the F2 overlay as an `ActivityOverlay` reading this registry. Absorb the shallow `InMemorySubagentRegistry`.

Principle: **one source of truth, fed by events that already flow.** No new polling except a single elapsed-refresh ticker that runs only while the panel is open.

## 2. Goals / constraints recap

See PRD §3–4. Key constraints: event-driven (N1), no leaks (N2), no behavior change when closed (N3), backward-compatible with `SubagentRegistry`/`SubagentSnapshot` consumers (N4), read-only (no kill) this version.

## 3. Architecture

```
 agent-loop / tools  ──emit──▶  AgentEvent stream
                                     │
        interactive-mode.handleEvent (already fans out)
                                     │  (new: also feed registry)
                                     ▼
                          ActivityRegistry  ◀── direct hooks: bash pid, subagent current-tool
                                     │  list() / subscribe()
                                     ▼
                          ActivityOverlay (F2 side panel)  ── 1s ticker while open
```

### 3.1 Where it lives

`packages/coding-agent/src/core/activity/activity-registry.ts` — new module, **owned by `AgentSession`** (constructed in session ctor, disposed in session teardown). Session-scoped (one per session), so it naturally captures "this session's" activity and dies with it. `interactive-mode` reads it for the overlay.

Rationale (resolves PRD Q2): `AgentSession` already owns the `Agent`, subscribes to its events, and has a dispose lifecycle. Registry as a session-owned module (not a global, not on the low-level `Agent`) keeps the runtime package pure and the registry session-scoped.

### 3.2 Data model

```ts
export type ActivityKind = "model" | "tool" | "subagent" | "process" | "mcp";
export type ActivityStatus = "running" | "queued" | "done" | "error";

export interface Activity {
	id: string;                 // stable; toolCallId, subagentId, "model:<runId>", "proc:<pid>"
	kind: ActivityKind;
	label: string;              // "model response", "bash", "task: test-writer"
	detail?: string;            // current sub-activity: bash command, child's current tool
	status: ActivityStatus;
	startedAt: number;          // ms epoch
	endedAt?: number;           // set on done/error; drives prune grace
	parentId?: string;          // for tree/depth (nested subagents, tool under subagent)
	pid?: number;               // bash child
	tokensIn?: number;          // when cheaply available; else undefined → render "—"
	tokensOut?: number;
}

export interface ActivitySnapshot extends Activity {
	depth: number;              // computed from parent chain at read time
	elapsedMs: number;          // computed at read time (now - startedAt, or endedAt - startedAt)
}
```

### 3.3 Registry API

```ts
export class ActivityRegistry {
	begin(a: Omit<Activity, "status"> & { status?: ActivityStatus }): void; // status defaults "running"
	update(id: string, patch: Partial<Pick<Activity,"detail"|"status"|"pid"|"tokensIn"|"tokensOut"|"label">>): void;
	end(id: string, opts?: { error?: boolean }): void;   // sets status done|error + endedAt; schedules prune
	list(): ActivitySnapshot[];                          // computes depth + elapsedMs; sorted (see §3.6)
	subscribe(listener: () => void): () => void;          // notify on any mutation
	clear(): void;
	dispose(): void;                                      // clear timers + listeners
}
```

- Internal store: `Map<string, Activity>` + ordered insertion. `notify()` debounced to a microtask to coalesce bursts.
- **Pruning:** `end()` sets `endedAt` and `setTimeout(removeGrace)` (default 4000ms; errors 8000ms). On removal → `notify()`. Timers tracked + cleared in `dispose()`.
- **Backward compat (N4):** registry also satisfies the existing `SubagentRegistry` shape (`list()` returning rows + `subscribe()`); `SubagentOverlay` is replaced by `ActivityOverlay`, and the old `SubagentSnapshot` is mapped from `ActivitySnapshot` for any lingering consumer (none expected after migration — grep shows only the overlay + tests).

### 3.4 Feed sources (event → registry)

In `interactive-mode.handleEvent` (the existing fan-out at ~2660), add registry calls alongside current handling. **No new subscription** — reuse the one that already drives the UI.

| Event | Registry call |
|-------|---------------|
| `agent_start` | `begin({ id: "model", kind:"model", label:"model response", startedAt: now })` |
| `message_update` (assistant streaming) | `update("model", { detail: "streaming" })` (once) |
| `agent_end` | `end("model")` |
| `tool_execution_start` | `begin({ id: toolCallId, kind: kindOf(toolName), label: labelOf(toolName,args), startedAt: event.startedAt, parentId: "model" })` |
| `tool_execution_update` | `update(toolCallId, { detail: deriveDetail(partialResult) })` |
| `tool_execution_end` | `end(toolCallId, { error: isError })` |
| `subagent_progress` | map onto the subagent's activity: `update(subagentId, { detail: phase==="tool"? detail : ..., status })`; `begin` on `started`, `end` on completed/failed; `parentId` = the spawning `task` tool's id |

`kindOf`: `bash`→ still `tool` (its child process is a separate `process` activity, see §3.5); `task`/`agent`→`subagent`; `mcp_tool_call`→`mcp`; else `tool`.

**New event field (agent package):** add `startedAt: number` to `tool_execution_start` (and carry through). Emitted at `agent-loop.ts` start sites (sequential `:452`, parallel `:493`). This is the one change in `packages/agent` (types + 2 emit sites). Backward compatible (additive field).

### 3.5 Bash child process + subagent current-tool hooks

Two pieces of live detail don't flow through events cleanly:

1. **Bash PID** — surface via the tool's existing `onUpdate` callback: when bash spawns, emit a `tool_execution_update` whose `partialResult` includes `{ pid }` (bash already streams partials). Registry `update(toolCallId, { pid, detail: command })`. No new event type. (Alternative considered: a dedicated process activity row keyed `proc:<pid>` parented under the bash tool — deferred; the pid-on-the-bash-row is enough for v1 "which command is slow.")
2. **Subagent current tool** — the `subagent_progress` event already exists and already reaches `interactive-mode` (currently only → `showStatus`). Add the registry `update` in that same handler (no new plumbing).

### 3.6 Read-time computation + sort

`list()`:
- compute `depth` by walking `parentId` chain (cap at depth 8 to avoid cycles).
- compute `elapsedMs` = `(endedAt ?? now) - startedAt`.
- sort: `running` & `queued` before `done`/`error`; within running, by `elapsedMs` desc (longest first = likely blocker, satisfies F8/S1); tree edges (children grouped under parent via stable secondary order).
- header counts (S3) derived from statuses.

### 3.7 Overlay

`packages/tui/src/components/ActivityOverlay.ts` (rename/replace `SubagentOverlay.ts`). Reuses render scaffolding (padRight, truncate, layoutRow, status badge). Adds: per-kind glyph/color, depth indent, blocking-item mark (top running row gets a subtle marker), header counts, empty state `No activity — session idle.`. Backed by `ActivityRegistry.list()`; `bindRedraw` unchanged.

**Elapsed ticker:** the overlay, while visible, runs `setInterval(1000)` → `requestRender()`; cleared on hide/dispose (N1, N3). The registry itself has no ticker.

### 3.8 Discoverability (F9)

- F2 keybinding repointed to the activity monitor (PRD Q5: F2 becomes unified). Update `keybindings.ts:139` description → "Toggle activity monitor".
- Add `/activity` slash command alias that calls the same toggle.
- Add F2 hint to `keybinding-hints.ts` (currently absent).

## 4. File-by-file changes

**packages/agent (runtime):**
- `src/types.ts` — add `startedAt: number` to `tool_execution_start` event.
- `src/agent-loop.ts` — set `startedAt: Date.now()` at the two `tool_execution_start` emit sites.

**packages/coding-agent:**
- `src/core/activity/activity-registry.ts` — NEW: `ActivityRegistry`, types, prune timers.
- `src/core/agent-session.ts` — construct + own + dispose the registry; expose `get activityRegistry()`.
- `src/modes/interactive/interactive-mode.ts` — feed registry in `handleEvent` (model/tool/subagent/process); construct `ActivityOverlay` with the session registry; repoint F2 toggle; `/activity` command.
- `src/core/tools/bash.ts` — include `pid` in the streamed partial (one line).
- `src/core/keybindings.ts` — F2 description.
- `src/modes/interactive/components/keybinding-hints.ts` — add F2 hint.
- DELETE/absorb `src/core/subagents-registry.ts` (`InMemorySubagentRegistry`) — replaced by `ActivityRegistry`; migrate the `onToolStart/onToolEnd` callers.

**packages/tui:**
- `src/components/ActivityOverlay.ts` — NEW (replaces `SubagentOverlay.ts`); keep `formatElapsed` import.
- `src/index.ts` — export ActivityOverlay (+ keep SubagentOverlay re-export as a thin alias for one release if any external consumer — internal only, so likely just replace).

## 5. Edge cases

| Case | Handling |
|------|----------|
| Tool ends before panel opens | recorded + pruned after grace; if panel opens within grace, shows as `done` then fades |
| Nested subagent (depth 2–3) | `parentId` chain → indent; depth cap 8 guards cycles |
| Parallel subagents over concurrency cap | spawner marks waiting ones `queued` (begin with status `queued`; flip to `running` on start) |
| Background subagent outlives turn | `model` activity ends, subagent activity persists (parentId still points at the ended task row, which is pruned → reparent to root on parent prune) |
| Bash killed / aborted | `tool_execution_end` with isError → `end(error)` |
| Duplicate `begin` (same id) | idempotent: update existing, don't duplicate |
| `end` for unknown id | no-op (defensive) |
| Registry mutated after dispose | guarded; no-op |
| Many activities (fan-out) | overlay caps rows (existing maxRows + `… +N more`) |

## 6. Testing

**Unit (`packages/coding-agent/.../activity/__tests__/`):**
- registry: begin/update/end transitions; elapsed + depth computation; sort (longest running first); prune timer (use fake timers) removes done after grace, errors after longer; idempotent begin; end-unknown no-op; dispose clears timers.
- snapshot mapping: kindOf/labelOf for bash/task/mcp/read.

**Integration (`interactive` harness):**
- simulate event sequence (agent_start → tool_execution_start(bash) → update(pid) → tool_execution_end → agent_end) → assert registry snapshot at each step.
- subagent_progress sequence → nested rows + current-tool detail.

**TUI (`packages/tui/test`, node:test):**
- ActivityOverlay render: empty state; running rows sorted; depth indent; done fading; header counts; overflow. Reuse the `settle()` pattern for any render-timing.

**Overhead check:** assert no ticker when panel closed (spy on setInterval) — registry mutations don't schedule renders by themselves beyond the debounced notify.

## 7. Rollout

Single feature branch, staged commits (registry → event feed → bash pid → overlay → discoverability → tests). No flag — additive + replaces the existing coarse overlay. `caveman` is `npm link`ed to this clone, so the user can test live after build.

## 8. Alternatives considered

- **A1 Extend `InMemorySubagentRegistry` in place.** Rejected: it's hardwired to task/agent tool calls + the `SubagentSnapshot` shape; widening it to all activity kinds is a bigger, messier change than a clean registry that absorbs it.
- **A2 Put the registry on the low-level `Agent`.** Rejected: pollutes the runtime package with UI-diagnostic concerns; `Agent` is shared by non-interactive surfaces. Session-owned is the right altitude.
- **A3 Poll OS for child processes (ps).** Rejected: cross-platform fragility, cost, and we already know our spawns. Surface our own PIDs instead.
- **A4 Separate ticker in the registry.** Rejected: registry should be passive (data only); the overlay owns the refresh cadence and only while visible (N1/N3).

## 9. Open questions for review

- OQ1 Is repointing F2 (vs a new key) the right call, or keep F2 = subagents and add a new key for the full monitor? (DD assumes repoint + absorb.)
- OQ2 Bash pid as a field on the tool row vs a distinct `process` child row — v1 picks field-on-row. Acceptable?
- OQ3 Prune grace values (4s / 8s) — reasonable, or make configurable?
- OQ4 Should the `model` activity always be present (even with no tools) as the root, or only when streaming? (DD: present from agent_start to agent_end.)
- OQ5 Reparenting orphaned subagents when their parent task row prunes — correct, or keep them pinned to the (gone) parent id and render at root?

---

## 11. Addendum: review resolutions + authoritative v1 scope

Three reviews (architecture, UX, skeptical) converged. Resolutions below. **This section is the buildable design.**

### 11.1 Blocker findings → resolutions

| # | Finding (all 3 reviewers) | Resolution |
|---|---------------------------|------------|
| B1 | `subagent_progress.subagentId` is minted in `task.ts runOne` (`task.ts:544`), NEVER equal to the `task` tool's `toolCallId`. `update(subagentId,…)` would no-op against a row that was never created. | **Thread the toolCallId down.** `task.ts execute(_id,...)` already receives the toolCallId; pass it as `subagentId` into `runOne`/`spawnSubagent` so the progress id === the tool row id. Small, contained change in `task.ts`. Then `subagent_progress` updates the SAME row created at `tool_execution_start`. |
| B2 | Nested subagents (depth ≥2) are separate child processes; parent only sees a digested `phase:"tool"` string; `flushLine` doesn't forward nested progress. Depth-tree unbuildable. | **DEFER nested tree to v2.** v1 = depth-1 only: one row per top-level `task`/`agent` tool call, with a mutating `detail` = the child's current tool (the digested string we DO get). No indentation tree in v1. PRD F4 amended accordingly. |
| B3 | Background subagents (`spawnSubagentBackground`) emit NO `onProgress` events — no event source. | **DEFER background live-view to v2** (needs a file-tailer of `~/.cave/tasks/{id}/output.jsonl` or an onProgress in the background spawn). v1 may optionally read `listBackground()` for a static "N background running" header line — cheap, no new events. |
| B4 | One `agent_start`/`agent_end` per *turn*; many LLM calls + tool loops inside. A single `model` row spanning the whole turn is always the oldest running → falsely marked the blocker (breaks U1/F8). | **Model row = per assistant LLM call.** Begin on assistant `message_start`, end on `message_end` (agent-loop emits these per call). Between tool round-trips there is NO model row — so a running bash is correctly the only running leaf. The turn-level span is dropped. |
| B5 | Blocker = "oldest running" wrongly picks the model container over the real leaf. | **Blocker = oldest running LEAF** (an activity with no running children). If the only running thing is the model call → it's the answer ("provider slow"). Containers never carry the blocker mark. |
| B6 | `AgentSession.dispose()` doesn't call registry dispose; overlay `hide()` ≠ `dispose()` → ticker leaks on every F2-close. | **Wire it:** add `activityRegistry.dispose()` to `AgentSession.dispose()`; on `/clear`/session-switch call `clear()`. Overlay ticker: start on show, **clear on hide** (make the toggle's hide path call the overlay's `stopTicker()`/`dispose()`). Add a test spying on `setInterval` proving no ticker when hidden. |
| B7 | Bash PID is not a one-liner — `child.pid` lives behind the pluggable `BashOperations.exec` interface. | **v1: show the bash command as `detail` (already in `args.command`) — that's the useful "which command is slow" signal.** DEFER raw PID surfacing to v2 (needs an `onSpawn(pid)` addition to `BashOperations`). |
| B8 | `kindOf` keyed on `mcp_tool_call` — no such tool name exists. | Determine MCP naming at implementation time (bridged tools carry a server prefix/flag). If cleanly detectable → `kind:"mcp"`; else treat as generic `tool`. Do NOT block v1 on a dedicated MCP kind. |

### 11.2 High-value UX additions (adopted into v1)

- **U-A1 — Blocking leaf in the spinner (biggest win, zero discovery cost).** Feed the current oldest-running-leaf label into `loader.setMessage`: `Working… bash: npm install (58s)` instead of `Working… (45s)`. The 80% case is answered without opening anything. The panel becomes the drill-down for fan-out. Registry exposes `blockingLeaf(): ActivitySnapshot | undefined`.
- **U-A2 — Stalled detection + watchdog tie-in.** Track `lastProgressAt` (bump on `message_update` for the model row, on `tool_execution_update` for tools). Derive a `stalled` state when `now - lastProgressAt` exceeds a threshold (reuse the stream idle-watchdog's notion). Render `1m02s · stalled 18s`. For the model row, when the idle-watchdog is counting toward auto-recover, surface `· auto-recovering` so the user doesn't Esc. This directly answers U3.
- **U-A3 — Don't prune while the panel is open.** Pruning (done→remove after grace) applies only while the panel is CLOSED (keeps the closed-state notion of "now" for the spinner-fed blocker). While OPEN: completed items stay, sunk + muted, until panel close or end of turn — so the just-finished long pole the user came to see doesn't vanish mid-read. No fade-removal while visible.
- **U-A4 — Drop token columns** from the default view (vanity for this JTBD; frees the narrow right gutter for elapsed + stalled).
- **U-A5 — Unify glyphs** across spinner/inline-status/panel: `●` running, `◍` stalled, `◌` queued, `○` done, `✗` error. Demote inline `subagent_progress` transcript spam to milestones only (`started`/`completed`/`failed`); the panel owns live `tool`-phase chatter.

### 11.3 Authoritative v1 feed map (corrected)

| Trigger (existing event) | Registry call |
|--------------------------|---------------|
| assistant `message_start` | `begin({ id: "model:"+msgId, kind:"model", label:"model response", startedAt: now, lastProgressAt: now })` |
| `message_update` (assistant) | `update("model:"+msgId, { lastProgressAt: now, detail:"streaming" })` |
| `message_end` (assistant) | `end("model:"+msgId)` |
| `tool_execution_start` (+ new `startedAt` field) | `begin({ id: toolCallId, kind: kindOf(name), label: labelOf(name,args), detail: detailOf(name,args), startedAt: event.startedAt, lastProgressAt: event.startedAt })` |
| `tool_execution_update` | `update(toolCallId, { lastProgressAt: now, detail: deriveDetail(partialResult) })` |
| `tool_execution_end` | `end(toolCallId, { error: isError })` |
| `subagent_progress` (after B1 fix: id === toolCallId) | `update(toolCallId, { detail: phase==="tool"? "→ "+detail : detail, status })`; transcript milestone only on started/completed/failed |

No `parentId` tree in v1 (B2). `depth` always 0; the field stays on the model for v2 but render is flat. Sort: running/queued first, then by `elapsedMs` desc; done/error sink. Blocker = oldest running leaf (v1: leaf = any running non-`model` row, else the model row).

### 11.4 v1 file changes (corrected from §4)

- `packages/agent/src/types.ts` — add `startedAt:number` to `tool_execution_start` (additive; verified low-risk by reviewer).
- `packages/agent/src/agent-loop.ts` — set `startedAt` at the 2 emit sites (`:452`, `:493`).
- `packages/coding-agent/src/core/activity/activity-registry.ts` — NEW registry (+ `blockingLeaf()`, `lastProgressAt`, prune-only-when-closed flag).
- `packages/coding-agent/src/core/tools/task.ts` — thread `toolCallId` → `subagentId` (B1).
- `packages/coding-agent/src/core/agent-session.ts` — own + `dispose()` + `clear()` the registry; expose `get activityRegistry()`.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — feed registry in `handleEvent` (corrected map); construct `ActivityOverlay`; repoint F2; feed `blockingLeaf()` into the loader message (U-A1); panel open/close toggles prune-pause + ticker.
- `packages/tui/src/components/ActivityOverlay.ts` — NEW (replaces `SubagentOverlay.ts`); keep `SubagentOverlay`/`SubagentRegistry` as thin published-API aliases for one release (N4).
- `packages/coding-agent/src/core/keybindings.ts` — F2 description → "Toggle activity monitor".
- `packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts` — add F2 hint.
- Absorb `packages/coding-agent/src/core/subagents-registry.ts` into the new registry.

### 11.5 Explicitly deferred to v2 (documented, not silently dropped)

Nested subagent tree (depth ≥2); live background-subagent view; raw bash PID; goal-loop cross-process surfacing; dedicated MCP kind if undetectable; `/activity` slash alias (slash→TUI-toggle is not a clean existing seam). Each requires new cross-process/interface plumbing beyond the existing event stream.

### 11.6 Go decision

**GO on the v1 in §11**, which is fully feedable from the existing event stream plus two small contained changes (the `startedAt` field and the `toolCallId→subagentId` thread). It delivers the JTBD: live running activities with correct per-call model timing, elapsed, stalled detection, the blocker surfaced **in the spinner** (no discovery cost) and in the panel, with correct lifecycle. The unbuildable-without-deep-plumbing parts are explicitly v2.
