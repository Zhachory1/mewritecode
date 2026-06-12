import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityRegistry } from "../activity-registry.js";

describe("ActivityRegistry", () => {
	let now = 1_000_000;
	beforeEach(() => {
		now = 1_000_000;
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

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

	it("notifies subscribers (coalesced) and dispose clears timers", async () => {
		const r = new ActivityRegistry();
		const cb = vi.fn();
		r.subscribe(cb);
		r.begin({ id: "t1", kind: "tool", label: "x", startedAt: now });
		r.begin({ id: "t2", kind: "tool", label: "y", startedAt: now });
		await Promise.resolve(); // flush coalesced microtask
		expect(cb).toHaveBeenCalled();
		expect(r.list()).toHaveLength(2);
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

	it("idempotent begin preserves the original startedAt (elapsed never jumps back)", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "t1", kind: "subagent", label: "task", startedAt: now });
		vi.setSystemTime(now + 5000);
		// a later duplicate begin (e.g. subagent_progress "started") must NOT reset startedAt
		r.begin({ id: "t1", kind: "subagent", label: "task: writer", startedAt: now + 5000 });
		const a = r.list()[0];
		expect(a.elapsedMs).toBe(5000); // still measured from the original start
		expect(a.label).toBe("task: writer"); // mutable fields still update
	});

	it("clear() removes all items and cancels pending prune timers", () => {
		const r = new ActivityRegistry();
		r.begin({ id: "a", kind: "tool", label: "x", startedAt: now });
		r.begin({ id: "b", kind: "tool", label: "y", startedAt: now });
		r.end("a");
		r.clear();
		expect(r.list()).toHaveLength(0);
		vi.advanceTimersByTime(10000); // a pre-clear prune timer must not resurrect/throw
		expect(r.list()).toHaveLength(0);
	});
});
