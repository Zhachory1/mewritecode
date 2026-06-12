# PRD: Session Activity Monitor

- Status: draft
- Author: Zhach Volker
- Date: 2026-06-12
- Surface: `packages/coding-agent` (interactive TUI) + `packages/agent` (runtime events) + `packages/tui` (overlay)

## 1. Problem

Reply take long. User stare at spinner. No way know why. Spinner say `Working... (45s)` but not WHAT working. Is it:
- model still streaming (slow provider)?
- a bash command stuck (`npm install`, `tail -f`)?
- 3 subagents running, one wedged?
- an MCP call hanging?
- nested subagent 2 levels deep, blocked?

Today: no answer. User must guess, hit Esc, lose work. Claude Code show live list of running tasks/agents — user see at a glance what spawned, how long each run, which one slow. Cavecode lack this.

We just shipped stream idle-watchdog (auto-recover hung streams) + elapsed timer on spinner. Next step: **show the user the full set of concurrent activity the session kicked off, live, so they diagnose slowness themselves.**

## 2. Background — current state

(From codebase investigation, 2026-06-12.)

F2 overlay exist (`SubagentOverlay`) + wired to real `InMemorySubagentRegistry`. BUT coarse + incomplete:
- Tracks only `task`/`agent` tool calls (one flat row each).
- `tokensIn`/`tokensOut` hardcoded `0`.
- `currentTool` = parent tool name (`"task"`), never the child's real current activity.
- No depth/tree despite nested subagents (depth ≤3).
- Rows never pruned (done/error linger forever).
- **Shows nothing else** — no bash child processes, no MCP calls, no the in-flight model request itself (the #1 reason replies are slow).

No central source of truth. Activity scattered across 11 owners (model `activeRun` AbortController, `AgentState.pendingToolCalls`, two separate subagent registries, bash PID in a closure, MCP per-server `lastUsed`, on-disk goal lock, file watchers). `tool_execution_start` event carries no start timestamp. Bash PID never surfaced. MCP has no in-flight call set.

So: the bones exist (overlay + event stream + one registry), but the registry is shallow and blind to most activity.

## 3. Goals

1. **Answer "why is this reply slow?"** — at any moment, user sees every concurrent activity the session has in flight, each with elapsed time + status, newest/longest surfaced.
2. **Unified view** — one activity model covering: the in-flight model request, running tools (bash/read/edit/grep/MCP/etc.), subagents (foreground, parallel, nested, background), and the bash child processes they spawn.
3. **Live + low-overhead** — updates as activity starts/ends; negligible perf cost; no new polling threads where events suffice.
4. **Discoverable** — user can find it (keybinding hinted; slash command alias).
5. **Diagnostic depth** — show enough per item (kind, label, elapsed, status, current sub-activity, depth) to identify the culprit, plus the single oldest/slowest "blocking" item.

## 4. Non-goals

- NOT a process manager — no kill/pause/resume from the panel this version (Esc still aborts the whole turn). (Stretch: kill a single hung item — deferred.)
- NOT cross-session / system-wide — only THIS session's activity. (Goal-loop child processes are separate-process; surface them only if cheap via the on-disk lock — otherwise defer.)
- NOT historical analytics / timeline replay — live snapshot only. (Session cost/duration already lives in StatusLine.)
- NOT token-accounting accuracy for subagents if it needs parsing child JSONL streams at cost — show tokens only where already available; `0`/`—` otherwise.
- NOT web-ui / mom / SDK surfaces — interactive TUI only.

## 5. Users & use cases

Anyone running `caveman` interactive.

- **U1 — slow reply triage:** reply hangs 60s. User opens monitor, sees `bash: npm install (58s)` is the long pole → waits, or Esc. (Most common.)
- **U2 — runaway fan-out:** user asked for a big refactor; 4 parallel subagents running. Monitor shows all 4 + which is slowest + nesting.
- **U3 — silent stall:** spinner climbs, no output. Monitor shows `model request (90s, streaming)` vs `mcp: github.search (90s)` → distinguishes provider stall from a hung MCP tool (ties to the idle-watchdog work).
- **U4 — background work:** a `background:true` subagent still running after the turn returned. Monitor shows it persists; user knows work continues.

## 6. Requirements

### 6.1 Functional — Must

- **F1 Unified activity registry.** One session-scoped registry holding all live activities. Each activity record: stable id, kind (`model` | `tool` | `subagent` | `process` | `mcp`), human label, `startedAt`, status (`running` | `done` | `error` | `queued`), optional parent id (for tree/depth), optional detail (current sub-activity), optional metrics (tokens, pid).
- **F2 Model request tracked.** The in-flight model stream appears as the root activity with elapsed, marked `streaming`. This is the default "what's happening" when no tools run.
- **F3 Tool activity tracked with timing.** Every tool execution (start→end) recorded with a real start timestamp (add timestamp at `tool_execution_start`). Elapsed live. Covers bash, read, edit, grep, ls, MCP bridge, task, all.
- **F4 Subagents — rich + nested.** Subagent rows show the child's CURRENT activity (not the parent tool name) and nest under their parent (depth/tree). Parallel subagents waiting on the concurrency cap show `queued`. Background subagents appear and persist past turn end.
- **F5 Bash child processes.** Bash tool surfaces its child PID + command into the registry so a long shell command is visibly the long pole.
- **F6 Live updates.** Panel reflects start/update/end within one render cycle; no manual refresh.
- **F7 Pruning.** Completed (`done`/`error`) items fade/auto-remove after a short grace (e.g. 3–5s) so the panel reflects "now," not session history. Errors may linger slightly longer.
- **F8 Blocking-item highlight.** Panel surfaces the single oldest running activity (the likely culprit) distinctly (e.g. top, or marked).
- **F9 Toggle + discoverability.** Existing F2 keybinding upgraded to this monitor; hinted in the footer/keybinding hints; a slash alias (e.g. `/activity`) opens it.

### 6.2 Functional — Should

- **S1** Sort: running first, by elapsed desc (longest at top); done/error sink + fade.
- **S2** Per-kind icon/color (model/tool/subagent/process/mcp) for fast scan.
- **S3** Show count summary in header: `Activity (3 running, 1 queued)`.
- **S4** Truncate gracefully at panel width; overflow `… +N more`.

### 6.3 Non-functional

- **N1 Overhead:** event-driven, no new timers except one shared ~1s ticker to refresh elapsed while the panel is open (stop ticker when closed). Registry ops O(1).
- **N2 No leaks:** activities removed on end + prune; registry bounded; subscriptions cleaned on session dispose.
- **N3 No behavior change** when the panel is closed beyond cheap bookkeeping (recording start/end). Closed panel = no ticker, no render.
- **N4 Backward compatible:** existing `SubagentRegistry`/`SubagentSnapshot` consumers keep working (extend, don't break).

## 7. UX (sketch)

Right-side panel (reuse existing side-panel), toggle F2:

```
 Activity (2 running · 1 queued)
 ● model response            streaming   1m02s   ← longest / blocking
 ● bash  npm install         running       58s
   ◌ task: test-writer        queued         —
 ○ read  src/agent-loop.ts   done           0s
```

- `●` running (accent), `◌` queued (muted), `○` done (muted, fading), `✗` error.
- Indent = depth (nested subagent under its parent).
- Right column = elapsed (live).
- Longest-running item visually marked as the likely blocker.
- Empty state: `No activity — session idle.`

## 8. Success criteria

- Open monitor mid-turn → see the model request + every running tool/subagent/bash child with correct live elapsed.
- A `bash sleep 30` is clearly the long pole (top, elapsed climbing).
- Parallel `task` fan-out shows N subagents, queued ones marked, nested ones indented, each showing its real current tool.
- Completed items disappear within the grace window; panel reflects "now."
- Closing the panel stops all monitor-related work (no ticker, no renders).
- No measurable latency added to tool execution or streaming.

## 9. Risks

- **R1 Scope creep into a process manager.** Mitigate: read-only this version (non-goal kill/pause).
- **R2 Two existing registries + scattered state.** Risk of a third parallel system. Mitigate (design doc): one registry fed by the existing event stream; migrate/absorb the shallow `InMemorySubagentRegistry` rather than add beside it.
- **R3 Child-process / background / goal-loop state is cross-process.** Surfacing live child detail (token spend, current tool of a detached subagent) may need JSONL parsing — cost. Mitigate: show what's cheaply available; defer deep child introspection.
- **R4 Render churn from a 1s ticker.** Mitigate: ticker only while panel open; diff-render already minimizes cost.

## 10. Open questions (resolve in design doc)

- Q1 Absorb `InMemorySubagentRegistry` into the new registry, or layer the new one and deprecate the old? (Lean: absorb.)
- Q2 Where does the registry live — `AgentSession` (per-session, has the event stream) vs a new module the session owns? (Lean: session-owned module fed by events.)
- Q3 Do we surface goal-loop child processes (separate process, on-disk lock) in v1, or defer? (Lean: defer; note in panel if a goal lock is held.)
- Q4 Tokens for subagents — parse child JSONL now or show `—`? (Lean: `—` v1.)
- Q5 Keep F2 for this, or new key + keep F2 = old subagent view? (Lean: F2 becomes the unified monitor.)

## Appendix A — activity taxonomy (from investigation)

| Kind | Source today | Has start time? | Tracked? |
|------|--------------|-----------------|----------|
| model request | `Agent.activeRun` + `AgentState.isStreaming` | no | partial |
| tool exec | `tool_execution_start/update/end` events; `AgentState.pendingToolCalls` | **no (add)** | partial |
| subagent (fg/parallel/nested) | `task.ts` promises + `InMemorySubagentRegistry` | yes (`startMs`) | shallow |
| subagent (background) | `subagent-registry.ts` `Map` | yes (`startedAt`) | yes, separate |
| bash child process | `bash.ts` `child.pid` (closure only) | renderer-local | **no (surface)** |
| MCP call | `McpHub` per-server `lastUsed` | no | **no** |
| goal loop | on-disk `lock.json` | yes (on disk) | cross-process |
