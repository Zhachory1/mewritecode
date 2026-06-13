/**
 * Savings Meter — SavingsTracker unit tests (DD §10.6).
 *
 * Hand-checkable arithmetic: bytes-led, tokens ≈ bytes/4, $ ≈ tokens×rate/1e6,
 * honest denominator, cache-reuse kept separate, max(0) clamp, reset.
 */

import { describe, expect, it } from "vitest";
import { SavingsTracker } from "../savings-tracker.js";

describe("SavingsTracker", () => {
	it("accrues bytesSaved + bySource for each recorded saving", () => {
		const t = new SavingsTracker();
		t.recordSaving("dedup", 1000);
		t.recordSaving("compression", 400);
		t.recordSaving("compaction", 200);
		t.recordSaving("compression", 100); // accumulates

		const totals = t.totals();
		expect(totals.bytesSaved).toBe(1700);
		expect(totals.bySource).toEqual({
			dedup: { bytes: 1000 },
			compression: { bytes: 500 },
			compaction: { bytes: 200 },
		});
	});

	it("accrues totalToolOutputBytes (the denominator) for every result", () => {
		const t = new SavingsTracker();
		t.recordToolOutput(2000);
		t.recordToolOutput(3000);
		expect(t.totals().totalToolOutputBytes).toBe(5000);
	});

	it("tokensSavedApprox == round(bytesSaved/4)", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", 4002); // 4002/4 = 1000.5 -> round 1001 (rounds to even? Math.round → 1001)
		expect(t.totals().tokensSavedApprox).toBe(Math.round(4002 / 4));
	});

	it("dollarsSavedApprox == tokensSavedApprox × rate / 1e6", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", 4000); // 1000 tokens
		const rate = 3; // $3 / Mtok
		const totals = t.totals(rate);
		expect(totals.tokensSavedApprox).toBe(1000);
		expect(totals.dollarsSavedApprox).toBeCloseTo((1000 * 3) / 1e6, 12);
	});

	it("dollarsSavedApprox is 0 for unknown pricing (rate 0 / negative)", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", 4000);
		expect(t.totals(0).dollarsSavedApprox).toBe(0);
		expect(t.totals(-5).dollarsSavedApprox).toBe(0);
	});

	it("percentCompressed == bytesSaved / totalToolOutputBytes", () => {
		const t = new SavingsTracker();
		t.recordToolOutput(1000);
		t.recordSaving("compression", 250);
		expect(t.totals().percentCompressed).toBeCloseTo(0.25, 12);
		expect(t.percentCompressed()).toBeCloseTo(0.25, 12);
	});

	it("percentCompressed is 0-guarded when no tool output recorded", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", 250);
		expect(t.percentCompressed()).toBe(0);
		expect(t.totals().percentCompressed).toBe(0);
	});

	it("clamps negative savings to 0 (compression made it bigger)", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", -500);
		expect(t.totals().bytesSaved).toBe(0);
		expect(t.totals().bySource.compression.bytes).toBe(0);
	});

	it("cache-reuse is SEPARATE — not in bytesSaved / tokens / dollarsApprox", () => {
		const t = new SavingsTracker();
		t.recordSaving("compression", 4000);
		t.setCacheReuseDollars(0.42);
		const totals = t.totals(3);
		expect(totals.cacheReuseDollars).toBe(0.42);
		// caveman total untouched by cache-reuse
		expect(totals.bytesSaved).toBe(4000);
		expect(totals.tokensSavedApprox).toBe(1000);
		expect(totals.dollarsSavedApprox).toBeCloseTo((1000 * 3) / 1e6, 12);
	});

	it("setCacheReuseDollars clamps invalid input to 0", () => {
		const t = new SavingsTracker();
		t.setCacheReuseDollars(Number.NaN);
		expect(t.totals().cacheReuseDollars).toBe(0);
		t.setCacheReuseDollars(-1);
		expect(t.totals().cacheReuseDollars).toBe(0);
	});

	it("ignores non-finite / non-positive tool output and savings", () => {
		const t = new SavingsTracker();
		t.recordToolOutput(Number.NaN);
		t.recordToolOutput(0);
		t.recordToolOutput(-10);
		t.recordSaving("dedup", Number.POSITIVE_INFINITY);
		expect(t.totals().totalToolOutputBytes).toBe(0);
		expect(t.totals().bytesSaved).toBe(0);
	});

	it("reset() zeroes all state", () => {
		const t = new SavingsTracker();
		t.recordToolOutput(1000);
		t.recordSaving("dedup", 500);
		t.setCacheReuseDollars(0.1);
		t.reset();
		const totals = t.totals();
		expect(totals.bytesSaved).toBe(0);
		expect(totals.totalToolOutputBytes).toBe(0);
		expect(totals.cacheReuseDollars).toBe(0);
		expect(totals.bySource).toEqual({
			dedup: { bytes: 0 },
			compression: { bytes: 0 },
			compaction: { bytes: 0 },
		});
	});

	it("percentCompressed clamps to 100% when compaction pushes savings over the denominator", () => {
		const t = new SavingsTracker();
		t.recordToolOutput(1000); // denominator
		t.recordSaving("compression", 600);
		t.recordSaving("compaction", 700); // second pass on already-counted output → over denominator
		expect(t.totals().bytesSaved).toBe(1300);
		expect(t.percentCompressed()).toBe(1); // clamped, never >1
	});
});
