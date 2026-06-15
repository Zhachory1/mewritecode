/**
 * run-swebench-timeout.test.ts — unit tests for the PURE wall-clock timeout
 * wrapper that guards a stalled SWE-bench instance (#32). NO network, NO
 * filesystem, NO AgentSession: `withInstanceTimeout` is a plain race helper and
 * `erroredInstanceResult` is a pure builder, both exercised in isolation.
 *
 * Context: the agent-loop idle-timeout did NOT fire on the SDK `session.prompt`
 * path and the cost --cap can't trip on a stalled (cost-free) request, so a
 * frozen turn would hang the whole condition. These tests prove the belt:
 * a never-resolving promise is bounded by the timeout, the cancel hook is
 * invoked exactly once, and the helper resolves to the errored result rather
 * than hanging.
 */

import { describe, expect, it, vi } from "vitest";
import { erroredInstanceResult, withInstanceTimeout } from "../run-swebench.js";

describe("erroredInstanceResult", () => {
	it("returns empty patch, all four token fields null, and the given error", () => {
		const r = erroredInstanceResult("instance timeout after 900s", 1234);
		expect(r.patch).toBe("");
		expect(r.cost).toBe(0);
		expect(r.toolCalls).toBe(0);
		expect(r.durationMs).toBe(1234);
		expect(r.error).toBe("instance timeout after 900s");
		// null (not 0) so the failed run is excludable from accounting.
		expect(r.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null });
	});
});

describe("withInstanceTimeout", () => {
	it("resolves to the timeout value (does NOT hang) on a never-resolving promise", async () => {
		const never = new Promise<string>(() => {
			/* never settles — simulates the stalled model turn */
		});
		const onTimeout = vi.fn();
		const result = await withInstanceTimeout(never, 10, onTimeout, "TIMED_OUT");
		expect(result).toBe("TIMED_OUT");
		// Real cancel hook fired exactly once.
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it("passes the original value through when the promise resolves before the timeout", async () => {
		const onTimeout = vi.fn();
		const result = await withInstanceTimeout(Promise.resolve("done"), 1000, onTimeout, "TIMED_OUT");
		expect(result).toBe("done");
		// Cancel hook must NOT fire on the happy path.
		expect(onTimeout).not.toHaveBeenCalled();
	});

	it("propagates a rejection that happens before the timeout (no cancel)", async () => {
		const onTimeout = vi.fn();
		await expect(
			withInstanceTimeout(Promise.reject(new Error("boom")), 1000, onTimeout, "TIMED_OUT"),
		).rejects.toThrow("boom");
		expect(onTimeout).not.toHaveBeenCalled();
	});

	it("does not invoke the cancel hook more than once and ignores late settlement", async () => {
		let rejectLate: ((e: unknown) => void) | undefined;
		const slow = new Promise<string>((_resolve, reject) => {
			rejectLate = reject;
		});
		const onTimeout = vi.fn();
		const result = await withInstanceTimeout(slow, 10, onTimeout, "TIMED_OUT");
		expect(result).toBe("TIMED_OUT");
		// The orphaned turn rejects AFTER we've moved on — must be swallowed, not
		// surface as an unhandled rejection, and must not re-fire the hook.
		rejectLate?.(new Error("late rejection from orphaned turn"));
		await new Promise((r) => setTimeout(r, 5));
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it("still resolves to the timeout value when the cancel hook itself throws", async () => {
		const never = new Promise<string>(() => {});
		const onTimeout = vi.fn(() => {
			throw new Error("abort() blew up");
		});
		const result = await withInstanceTimeout(never, 10, onTimeout, "TIMED_OUT");
		expect(result).toBe("TIMED_OUT");
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it("composes with erroredInstanceResult exactly as the runner does", async () => {
		const never = new Promise<undefined>(() => {});
		const SENTINEL = Symbol("instance-timeout");
		const aborted = vi.fn();
		const raced = await withInstanceTimeout<undefined | typeof SENTINEL>(never, 10, () => aborted(), SENTINEL);
		expect(raced).toBe(SENTINEL);
		const r = raced === SENTINEL ? erroredInstanceResult("instance timeout after 900s", 5) : null;
		expect(r?.error).toBe("instance timeout after 900s");
		expect(r?.tokens.input).toBeNull();
		expect(aborted).toHaveBeenCalledTimes(1);
	});
});
