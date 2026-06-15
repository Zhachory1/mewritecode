import { describe, expect, it, vi } from "vitest";
import {
	StreamIdleTimeoutError,
	StreamTotalTimeoutError,
	withIdleTimeout,
	withTotalTimeout,
} from "../../src/utils/idle-timeout.js";

/** Async iterable that yields `values` then completes normally. */
function finite<T>(values: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			yield* values;
		},
	};
}

/** Async iterable that yields `values` then stalls forever (next() never resolves). */
function stalls<T>(values: T[]): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			let i = 0;
			return {
				next(): Promise<IteratorResult<T>> {
					if (i < values.length) return Promise.resolve({ value: values[i++], done: false });
					return new Promise<IteratorResult<T>>(() => {}); // never resolves (stall)
				},
			};
		},
	};
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const v of it) out.push(v);
	return out;
}

describe("withIdleTimeout", () => {
	it("passes through all values when the source stays active", async () => {
		const out = await collect(withIdleTimeout(finite([1, 2, 3]), 1000));
		expect(out).toEqual([1, 2, 3]);
	});

	it("throws StreamIdleTimeoutError when the source stalls", async () => {
		await expect(collect(withIdleTimeout(stalls([1]), 50))).rejects.toBeInstanceOf(StreamIdleTimeoutError);
	});

	it("invokes onTimeout exactly once when it trips", async () => {
		const onTimeout = vi.fn();
		await expect(collect(withIdleTimeout(stalls([1]), 50, onTimeout))).rejects.toBeInstanceOf(StreamIdleTimeoutError);
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it("disables the watchdog when idleMs <= 0 (passthrough)", async () => {
		const out = await collect(withIdleTimeout(finite([1, 2]), 0));
		expect(out).toEqual([1, 2]);
	});

	it("does not trip when each value arrives within the idle window", async () => {
		async function* slowButSteady(): AsyncGenerator<number> {
			for (const n of [1, 2, 3]) {
				await new Promise((r) => setTimeout(r, 30));
				yield n;
			}
		}
		const out = await collect(withIdleTimeout(slowButSteady(), 100));
		expect(out).toEqual([1, 2, 3]);
	});
});

describe("withTotalTimeout", () => {
	it("passes through all values when the source completes within budget", async () => {
		const out = await collect(withTotalTimeout(finite([1, 2, 3]), 1000));
		expect(out).toEqual([1, 2, 3]);
	});

	it("throws StreamTotalTimeoutError when a steady-but-slow source exceeds the budget", async () => {
		// Each value arrives within any reasonable idle window, but the TOTAL
		// run blows past the cap — this is exactly the gap idle-timeout misses.
		async function* slowButSteady(): AsyncGenerator<number> {
			for (let n = 0; n < 100; n++) {
				await new Promise((r) => setTimeout(r, 20));
				yield n;
			}
		}
		await expect(collect(withTotalTimeout(slowButSteady(), 60))).rejects.toBeInstanceOf(StreamTotalTimeoutError);
	});

	it("throws StreamTotalTimeoutError when the source stalls past the budget", async () => {
		await expect(collect(withTotalTimeout(stalls([1]), 50))).rejects.toBeInstanceOf(StreamTotalTimeoutError);
	});

	it("invokes onTimeout exactly once when it trips", async () => {
		const onTimeout = vi.fn();
		await expect(collect(withTotalTimeout(stalls([1]), 50, onTimeout))).rejects.toBeInstanceOf(
			StreamTotalTimeoutError,
		);
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it("disables the deadline when totalMs <= 0 (passthrough)", async () => {
		const out = await collect(withTotalTimeout(finite([1, 2]), 0));
		expect(out).toEqual([1, 2]);
	});

	it("does not reset the deadline per value (unlike idle)", async () => {
		// A source whose per-gap is comfortably under the budget but whose
		// cumulative time exceeds it must still trip. Budget 90ms, 5 gaps of 40ms.
		async function* steady(): AsyncGenerator<number> {
			for (let n = 0; n < 5; n++) {
				await new Promise((r) => setTimeout(r, 40));
				yield n;
			}
		}
		await expect(collect(withTotalTimeout(steady(), 90))).rejects.toBeInstanceOf(StreamTotalTimeoutError);
	});
});
