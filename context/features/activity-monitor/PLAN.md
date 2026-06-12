# Activity Monitor — Implementation Plan

> **For agentic workers:** Implement with subagents (one per chunk where independent) or sequentially. Steps use `- [ ]` checkboxes. Authoritative design = DD.md **§11** (v1 scope). TDD: failing test → impl → green → commit.

**Goal:** A live, session-scoped activity monitor (F2 panel + blocking-leaf surfaced in the spinner) so a user can see why a reply is slow — every running model call / tool / foreground subagent with elapsed + stalled detection.

**Architecture:** One `ActivityRegistry` owned by `AgentSession`, fed by the existing `AgentEvent` fan-out in `interactive-mode.handleEvent`. Overlay reads it. Two small enabling changes: add `startedAt` to `tool_execution_start`; thread `toolCallId → subagentId` in `task.ts`. Per-LLM-call model row (not per-turn). Blocker = oldest running leaf. Prune only while panel closed.

**Tech stack:** TypeScript strict, Node 20+. Tests: `packages/coding-agent` + `packages/agent` use **vitest** (`npx vitest --run <file>`); `packages/tui` uses **node:test** (`node --test --import tsx test/<file>`). Lint: Biome (`npx biome check --write --error-on-warnings <files>`). Build: `npm run build` (root, ordered). Verify CI-mirror with provider keys blanked + `GIT_CONFIG_GLOBAL=/dev/null`.

**Scope guard:** v1 = §11. Do NOT implement nested-tree, background live-view, raw bash PID, MCP-kind-if-undetectable, `/activity` slash (all v2, DD §11.5).

---

## File structure

- Create: `packages/coding-agent/src/core/activity/activity-registry.ts` (registry + types + `blockingLeaf`)
- Create: `packages/coding-agent/src/core/activity/__tests__/activity-registry.test.ts`
- Create: `packages/tui/src/components/ActivityOverlay.ts` (replaces SubagentOverlay)
- Create: `packages/tui/test/activity-overlay.test.ts`
- Modify: `packages/agent/src/types.ts` (+`startedAt`), `packages/agent/src/agent-loop.ts` (set it)
- Modify: `packages/coding-agent/src/core/tools/task.ts` (toolCallId→subagentId)
- Modify: `packages/coding-agent/src/core/agent-session.ts` (own/dispose/clear/getter)
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (feed, spinner, toggle, ticker/prune-pause)
- Modify: `packages/coding-agent/src/core/keybindings.ts` (F2 desc), `.../components/keybinding-hints.ts` (hint)
- Modify: `packages/tui/src/index.ts` (export ActivityOverlay + alias)
- Absorb/remove: `packages/coding-agent/src/core/subagents-registry.ts`

---

## Chunk 1: ActivityRegistry core (no UI, no wiring)

### Task 1.1 — types + registry skeleton (TDD)

**Files:** create `packages/coding-agent/src/core/activity/activity-registry.ts` + test.

- [ ] **Step 1: failing test** `__tests__/activity-registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityRegistry } from "../activity-registry.js";

describe("ActivityRegistry", () => {
	let now = 1_000_000;
	beforeEach(() => { now = 1_000_000; vi.useFakeTimers(); vi.setSystemTime(now); });
	afterEach(() => { vi.useRealTimers(); });

	it("begins running activities and lists them with elapsed", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "t1", kind: "tool", label: "bash", startedAt: now });
		vi.setSystemTime(now + 3000);
		const list = r.list();
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ id: "t1", status: "running", elapsedMs: 3000, depth: 0 });
	});

	it("update mutates detail/status/lastProgressAt; end sets done + endedAt", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "t1", kind: "tool", label: "bash", startedAt: now });
		r.update("t1", { detail: "npm install" });
		r.end("t1");
		expect(r.list()[0]).toMatchObject({ status: "done", detail: "npm install" });
	});

	it("end(error) marks error; unknown id is a no-op; begin is idempotent", () => {
		const r = new ActivityRegistry();
		r.end("nope"); // no throw
		r.begin({ id: "t1", kind: "tool", label: "x", startedAt: now });
		r.begin({ id: "t1", kind: "tool", label: "x2", startedAt: now }); // idempotent update
		r.end("t1", { error: true });
		const l = r.list();
		expect(l).toHaveLength(1);
		expect(l[0].status).toBe("error");
	});

	it("sorts running before done, longest-running first", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "old", kind: "tool", label: "old", startedAt: now - 5000 });
		r.begin({ id: "new", kind: "tool", label: "new", startedAt: now - 1000 });
		r.begin({ id: "fin", kind: "tool", label: "fin", startedAt: now - 9000 });
		r.end("fin");
		const ids = r.list().map((a) => a.id);
		expect(ids.slice(0, 2)).toEqual(["old", "new"]); // running, longest first
		expect(ids[2]).toBe("fin"); // done sinks
	});

	it("blockingLeaf returns oldest running non-model; model only if it's the sole runner", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "model:1", kind: "model", label: "model response", startedAt: now - 8000 });
		expect(r.blockingLeaf()?.id).toBe("model:1"); // model alone
		r.begin({ id: "t1", kind: "tool", label: "bash", startedAt: now - 2000 });
		expect(r.blockingLeaf()?.id).toBe("t1"); // a running tool beats the model container
	});

	it("prunes done activities after grace only when not paused", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "t1", kind: "tool", label: "x", startedAt: now });
		r.end("t1");
		vi.advanceTimersByTime(4001);
		expect(r.list()).toHaveLength(0);
	});

	it("setPruning(false) keeps done items; flush on re-enable", () => {
		const r = new ActivityRegistry();
		r.setPruning(false); // panel open
		r.begin({ id: "t1", kind: "tool", label: "x", startedAt: now });
		r.end("t1");
		vi.advanceTimersByTime(10000);
		expect(r.list()).toHaveLength(1); // kept while paused
		r.setPruning(true);
		vi.advanceTimersByTime(4001);
		expect(r.list()).toHaveLength(0);
	});

	it("notifies subscribers (coalesced) and dispose clears timers", () => {
		const r = new ActivityRegistry();
		const cb = vi.fn();
		r.subscribe(cb);
		r.begin({ id: "t1", kind: "tool", label: "x", startedAt: now });
		r.begin({ id: "t2", kind: "tool", label: "y", startedAt: now });
		vi.advanceTimersByTime(1); // flush microtask/coalesce
		expect(cb).toHaveBeenCalled();
		r.dispose(); // no throw, timers cleared
	});

	it("stalled: lastProgressAt drives stalledMs in snapshot", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "m", kind: "model", label: "model", startedAt: now, lastProgressAt: now });
		vi.setSystemTime(now + 20000);
		expect(r.list()[0].stalledMs).toBe(20000);
		r.update("m", { lastProgressAt: now + 20000 });
		expect(r.list()[0].stalledMs).toBe(0);
	});
});
```

- [ ] **Step 2: run, expect fail** `cd packages/coding-agent && npx vitest --run src/core/activity/__tests__/activity-registry.test.ts`
- [ ] **Step 3: implement** `activity-registry.ts`:

```ts
export type ActivityKind = "model" | "tool" | "subagent" | "process" | "mcp";
export type ActivityStatus = "running" | "queued" | "done" | "error";

export interface Activity {
	id: string;
	kind: ActivityKind;
	label: string;
	detail?: string;
	status: ActivityStatus;
	startedAt: number;
	lastProgressAt?: number;
	endedAt?: number;
	parentId?: string;
}

export interface ActivitySnapshot extends Activity {
	depth: number;
	elapsedMs: number;
	stalledMs: number; // now - lastProgressAt (0 if never progressed-tracked or just progressed)
}

const PRUNE_MS = 4000;
const PRUNE_ERR_MS = 8000;

export class ActivityRegistry {
	private items = new Map<string, Activity>();
	private order: string[] = [];
	private listeners = new Set<() => void>();
	private pruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private pruning = true;
	private disposed = false;
	private notifyScheduled = false;

	begin(a: Omit<Activity, "status"> & { status?: ActivityStatus }): void {
		if (this.disposed) return;
		const existing = this.items.get(a.id);
		if (existing) { Object.assign(existing, a, { status: a.status ?? existing.status }); this.notify(); return; }
		this.items.set(a.id, { status: "running", lastProgressAt: a.startedAt, ...a });
		this.order.push(a.id);
		this.notify();
	}

	update(id: string, patch: Partial<Pick<Activity, "detail"|"status"|"label"|"lastProgressAt"|"parentId">>): void {
		const it = this.items.get(id); if (!it) return;
		Object.assign(it, patch); this.notify();
	}

	end(id: string, opts?: { error?: boolean }): void {
		const it = this.items.get(id); if (!it) return;
		it.status = opts?.error ? "error" : "done";
		it.endedAt = Date.now();
		this.schedulePrune(id);
		this.notify();
	}

	setPruning(on: boolean): void {
		this.pruning = on;
		if (on) for (const id of [...this.items.keys()]) { const it = this.items.get(id)!; if (it.endedAt) this.schedulePrune(id); }
		else for (const t of this.pruneTimers.values()) clearTimeout(t);
	}

	private schedulePrune(id: string): void {
		if (!this.pruning) return;
		const it = this.items.get(id); if (!it?.endedAt) return;
		const old = this.pruneTimers.get(id); if (old) clearTimeout(old);
		const ms = it.status === "error" ? PRUNE_ERR_MS : PRUNE_MS;
		this.pruneTimers.set(id, setTimeout(() => this.remove(id), ms));
	}

	private remove(id: string): void {
		this.items.delete(id); this.order = this.order.filter((x) => x !== id);
		this.pruneTimers.delete(id); this.notify();
	}

	list(): ActivitySnapshot[] {
		const now = Date.now();
		const snaps = this.order.filter((id) => this.items.has(id)).map((id) => {
			const a = this.items.get(id)!;
			return {
				...a,
				depth: this.depthOf(a),
				elapsedMs: (a.endedAt ?? now) - a.startedAt,
				stalledMs: a.lastProgressAt ? now - a.lastProgressAt : 0,
			};
		});
		const rank = (s: ActivityStatus) => (s === "running" || s === "queued" ? 0 : 1);
		return snaps.sort((x, y) => rank(x.status) - rank(y.status) || y.elapsedMs - x.elapsedMs);
	}

	blockingLeaf(): ActivitySnapshot | undefined {
		const running = this.list().filter((a) => a.status === "running");
		const leaves = running.filter((a) => a.kind !== "model");
		return (leaves[0] ?? running.find((a) => a.kind === "model"));
	}

	private depthOf(a: Activity): number {
		let d = 0, cur = a.parentId, guard = 0;
		while (cur && this.items.has(cur) && guard++ < 8) { d++; cur = this.items.get(cur)!.parentId; }
		return d;
	}

	subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

	private notify(): void {
		if (this.disposed || this.notifyScheduled) return;
		this.notifyScheduled = true;
		queueMicrotask(() => { this.notifyScheduled = false; if (this.disposed) return; for (const l of this.listeners) l(); });
	}

	clear(): void { for (const t of this.pruneTimers.values()) clearTimeout(t); this.pruneTimers.clear(); this.items.clear(); this.order = []; this.notify(); }
	dispose(): void { this.disposed = true; for (const t of this.pruneTimers.values()) clearTimeout(t); this.pruneTimers.clear(); this.listeners.clear(); }
}
```

> NOTE on the coalesced-notify test under fake timers: if `queueMicrotask` isn't flushed by `advanceTimersByTime`, switch the test to `await Promise.resolve()` or assert via `list()` instead. Implementer: make the test deterministic (prefer asserting state via `list()` over spy-timing).

- [ ] **Step 4: run green.** Adjust test/impl until all pass. `npx vitest --run src/core/activity/__tests__/activity-registry.test.ts`
- [ ] **Step 5: biome + commit.**
```bash
npx biome check --write --error-on-warnings packages/coding-agent/src/core/activity/
git add packages/coding-agent/src/core/activity && git commit -m "feat(activity): add session ActivityRegistry core"
```

---

## Chunk 2: agent package — `startedAt` on tool_execution_start

### Task 2.1
**Files:** `packages/agent/src/types.ts`, `packages/agent/src/agent-loop.ts`.

- [ ] Add `startedAt: number` to the `tool_execution_start` event type in `types.ts` (additive).
- [ ] At both emit sites in `agent-loop.ts` (sequential ~`:452`, parallel ~`:493`) set `startedAt: Date.now()`.
- [ ] Existing agent tests must still pass: `cd packages/agent && npx vitest --run`. Add/adjust one assertion that a `tool_execution_start` carries a numeric `startedAt` in `test/agent-loop.test.ts`.
- [ ] biome + commit: `feat(agent): add startedAt to tool_execution_start event`.

---

## Chunk 3: task.ts — thread toolCallId → subagentId (B1)

### Task 3.1
**Files:** `packages/coding-agent/src/core/tools/task.ts`.

- [ ] In the task tool `execute(id, args, ...)`, thread `id` (the toolCallId) down to `runOne`/`spawnSubagent` so the emitted `subagent_progress.subagentId === id` (the toolCallId) for the single + parallel + chain cases. Where multiple subagents run under ONE task tool call (parallel/chain), suffix a stable index: `${id}#${i}` so each row is distinct AND derivable from the tool id.
- [ ] **Test (`test/` or existing task tests):** assert that the `onProgress` events emitted for a task call carry `subagentId` values prefixed by the provided toolCallId. If task.ts has no unit test harness for progress, add a focused one mocking `spawner`.
- [ ] Verify existing task tests pass: `npx vitest --run test/*task* src/**/*task*` (find them first).
- [ ] biome + commit: `fix(task): key subagent progress to the tool call id`.

---

## Chunk 4: AgentSession ownership + lifecycle

### Task 4.1
**Files:** `packages/coding-agent/src/core/agent-session.ts`.

- [ ] Construct `private _activityRegistry = new ActivityRegistry()` in the ctor; expose `get activityRegistry(): ActivityRegistry`.
- [ ] In `dispose()` (the existing one ~`:1547`) call `this._activityRegistry.dispose()`.
- [ ] On `/clear` / session reset path call `this._activityRegistry.clear()` (find the clear path; if none distinct, document that dispose covers it).
- [ ] Test: `agent-session` test asserting `session.activityRegistry` exists and `dispose()` is idempotent + clears (spy `setInterval`/timers not needed; assert no throw + registry disposed).
- [ ] biome + commit: `feat(agent-session): own + dispose the ActivityRegistry`.

---

## Chunk 5: interactive-mode wiring (feed + spinner + toggle + ticker/prune-pause)

Depends on Chunks 1–4 + 6 (overlay). Do after 6.

### Task 5.1 — feed the registry from handleEvent
**Files:** `interactive-mode.ts` (handleEvent ~`:2660`, subagent_progress ~`:2837`).

- [ ] In `handleEvent`, alongside existing handling, call the registry per **DD §11.3** map:
  - assistant `message_start` → `begin({ id: "model:"+id, kind:"model", label:"model response", startedAt: now, lastProgressAt: now })`
  - `message_update` (assistant) → `update("model:"+id, { lastProgressAt: now, detail: "streaming" })`
  - `message_end` (assistant) → `end("model:"+id)`
  - `tool_execution_start` → `begin({ id: toolCallId, kind: kindOf(name), label: labelOf(name,args), detail: detailOf(name,args), startedAt: event.startedAt, lastProgressAt: event.startedAt })`
  - `tool_execution_update` → `update(toolCallId, { lastProgressAt: now, detail: deriveDetail(partialResult) })`
  - `tool_execution_end` → `end(toolCallId, { error: isError })`
  - `subagent_progress` → `update(subagentId, { detail: phase==="tool" ? "→ "+detail : detail, lastProgressAt: now, status: mapStatus(phase) })`; `begin` on first sight; `end` on completed/failed
- [ ] `kindOf(name)`: `task`/`agent`→`subagent`; bash→`tool` (detail=command); MCP→detect bridged-tool naming (read mcp-bridge to find the real prefix; if undetectable use `tool`); else `tool`.
- [ ] Replace the old `subagentRegistry.onToolStart/onToolEnd` calls (absorbed).

### Task 5.2 — blocking leaf in the spinner (U-A1)
- [ ] Where the loader message is set during a turn, compute `const b = session.activityRegistry.blockingLeaf()` and set `loadingAnimation.setMessage(b ? \`${b.label}${b.detail? ": "+b.detail : ""}\` : defaultWorkingMessage)`. Update on registry change (subscribe) AND on the existing tick. Append `· stalled Ns` when `b.stalledMs > STALL_THRESHOLD` (reuse the 120s watchdog notion scaled — use e.g. 10s display threshold).

### Task 5.3 — toggle: ticker + prune-pause
- [ ] On panel SHOW: `activityRegistry.setPruning(false)`; start `setInterval(1000)` → `ui.requestRender()` (store handle).
- [ ] On panel HIDE: clear the interval; `activityRegistry.setPruning(true)`. Ensure the hide path actually runs this (the bug the review flagged: `hide()` ≠ overlay dispose).
- [ ] Repoint F2 action to the activity overlay (construct `ActivityOverlay` with `session.activityRegistry`).
- [ ] Demote inline `subagent_progress` `showStatus` spam to milestones only (started/completed/failed); panel owns live tool-phase.

### Task 5.4 — verify
- [ ] Integration test (interactive harness): drive event sequence, assert `session.activityRegistry.list()` + `blockingLeaf()` at each step (model row per call; bash tool becomes blocker; ends prune when closed).
- [ ] biome + commit: `feat(interactive): wire ActivityRegistry, spinner blocker, F2 panel`.

---

## Chunk 6: ActivityOverlay (tui) — replace SubagentOverlay

### Task 6.1 (TDD, node:test)
**Files:** create `packages/tui/src/components/ActivityOverlay.ts` + `test/activity-overlay.test.ts`; update `src/index.ts`; remove/alias `SubagentOverlay.ts`.

- [ ] **Failing test** (`node --test`): construct overlay with a fake registry returning a known `ActivitySnapshot[]`; assert render: empty state `No activity — session idle.`; running rows sorted longest-first; blocker row marked; `● ◍ ◌ ○ ✗` glyphs; `stalled Ns` shown when `stalledMs>threshold`; header `Activity (N running…)`; overflow `… +N more`. Reuse `formatElapsed`. (No real timers; pass snapshots directly.)
- [ ] **Implement** `ActivityOverlay` (port SubagentOverlay scaffolding: padRight/truncate/layoutRow). Columns: `glyph label detail … elapsed[ · stalled Ns]`. No token column (U-A4). Flat (no depth indent in v1; depth field ignored for render).
- [ ] Keep `formatElapsed` import from `../format-elapsed.js`.
- [ ] `src/index.ts`: export `ActivityOverlay`; keep `SubagentOverlay`/`SubagentRegistry`/`SubagentSnapshot`/`NULL_SUBAGENT_REGISTRY` as thin aliases re-exported for one release (N4 — published API). Simplest: keep the old file exporting a deprecated alias `export { ActivityOverlay as SubagentOverlay }` + type aliases.
- [ ] Run: `node --test --import tsx test/activity-overlay.test.ts` green; full tui suite stays green.
- [ ] biome + commit: `feat(tui): ActivityOverlay replacing SubagentOverlay`.

---

## Chunk 7: discoverability (F2 desc + hint)

### Task 7.1
- [ ] `keybindings.ts:139` description → `"Toggle activity monitor"`.
- [ ] `components/keybinding-hints.ts`: add an F2 hint (`F2 activity`).
- [ ] biome + commit: `feat: surface F2 activity monitor in keybinding hints`.

---

## Chunk 8: integration verification + full build

- [ ] `npm run build` (root) — clean.
- [ ] `npm run check` — biome + tsgo clean.
- [ ] Full CI-mirror test: `OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= GIT_CONFIG_GLOBAL=/dev/null npm test` — coding-agent + agent + tui green (ai lazy-module-load is a Node-25-local artifact, ignore; verify on its own).
- [ ] Manual smoke (caveman is npm-linked to this clone): rebuild, run `caveman`, prompt with a `bash sleep 20` → spinner shows `bash: sleep 20 (Ns)`; F2 shows it as the running blocker; finishes → row sinks/prunes after close.

## Done when
- All chunks committed on `feat/activity-monitor`.
- Registry + overlay tests green; agent + tui suites green; build + biome clean.
- Spinner shows the blocking leaf; F2 panel lists live activity with elapsed + stalled; lifecycle leak-free (no ticker when closed).
- v2 items remain deferred (DD §11.5).
