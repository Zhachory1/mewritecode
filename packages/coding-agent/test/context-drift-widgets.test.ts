import { describe, expect, it } from "vitest";
import {
	type ContextUsageSnapshot,
	DEFAULT_FIRE_STARTER_THRESHOLDS,
	emptyFireStarterState,
	emptyTribalSignalState,
	evaluateFireStarter,
	evaluateTribalSignal,
	type FireStarterState,
	type TribalSignalState,
} from "../src/modes/interactive/context-drift-widgets.js";

const usage = (tokens: number | null, percent: number | null, contextWindow = 200_000): ContextUsageSnapshot => ({
	tokens,
	percent,
	contextWindow,
});

describe("evaluateTribalSignal", () => {
	it("clears when usage is missing or percent is null", () => {
		expect(evaluateTribalSignal(null, emptyTribalSignalState()).effect).toEqual({ kind: "clear" });
		expect(evaluateTribalSignal(usage(0, null), emptyTribalSignalState()).effect).toEqual({ kind: "clear" });
	});

	it("clears below 60% and resets amberFired", () => {
		const prev: TribalSignalState = { amberFired: true, recentTurnTokens: [1000, 2000] };
		const out = evaluateTribalSignal(usage(50_000, 50), prev);
		expect(out.effect).toEqual({ kind: "clear" });
		expect(out.nextState.amberFired).toBe(false);
		// Recent tokens are preserved through a clear (used by future turns when usage rebounds).
		expect(out.nextState.recentTurnTokens).toEqual([1000, 2000]);
	});

	it("fires amber once at 70% and not again until reset", () => {
		const first = evaluateTribalSignal(usage(140_000, 71), emptyTribalSignalState());
		expect(first.effect).toEqual({ kind: "amber", pct: 71 });
		expect(first.nextState.amberFired).toBe(true);

		const second = evaluateTribalSignal(usage(141_000, 72), first.nextState);
		// Already amber-fired → no new amber event; falls through to amberClear.
		expect(second.effect).toEqual({ kind: "amberClear" });
		expect(second.nextState.amberFired).toBe(true);
	});

	it("fires red at 85%+", () => {
		const out = evaluateTribalSignal(usage(170_000, 85), emptyTribalSignalState());
		expect(out.effect.kind).toBe("red");
		if (out.effect.kind === "red") {
			expect(out.effect.message).toContain("85%");
		}
		expect(out.nextState.amberFired).toBe(true);
	});

	it("detects rate acceleration: 3 turns each >= 1.5x previous", () => {
		let state = emptyTribalSignalState();
		// Three growing turns: 100k → 150k → 225k. All above 60%.
		state = evaluateTribalSignal(usage(100_000, 60), state).nextState;
		state = evaluateTribalSignal(usage(150_000, 65), state).nextState;
		const out = evaluateTribalSignal(usage(225_000, 70, 250_000), state);
		expect(out.effect.kind).toBe("rateWarning");
	});

	it("does NOT fire rate-warning when growth is sub-1.5x", () => {
		let state = emptyTribalSignalState();
		state = evaluateTribalSignal(usage(100_000, 60), state).nextState;
		state = evaluateTribalSignal(usage(120_000, 62), state).nextState;
		const out = evaluateTribalSignal(usage(140_000, 65), state);
		expect(out.effect.kind).not.toBe("rateWarning");
	});

	it("rolling token window is capped at 5", () => {
		let state = emptyTribalSignalState();
		for (let i = 0; i < 10; i++) {
			state = evaluateTribalSignal(usage(60_000 + i * 1000, 61), state).nextState;
		}
		expect(state.recentTurnTokens.length).toBe(5);
	});

	it("amberClear fires when pct drops back below 70 after amber", () => {
		const prev: TribalSignalState = { amberFired: true, recentTurnTokens: [140_000] };
		const out = evaluateTribalSignal(usage(130_000, 65), prev);
		expect(out.effect.kind).toBe("amberClear");
		expect(out.nextState.amberFired).toBe(false);
	});
});

describe("evaluateFireStarter", () => {
	const NOW = 1_000_000;
	const compactDefaults = DEFAULT_FIRE_STARTER_THRESHOLDS;

	it("returns nothing when usage is missing or tokens/percent null", () => {
		const empty = emptyFireStarterState();
		expect(evaluateFireStarter(null, empty, NOW, false).shouldCompact).toBe(false);
		expect(evaluateFireStarter(usage(null, 50), empty, NOW, false).shouldCompact).toBe(false);
		expect(evaluateFireStarter(usage(1000, null), empty, NOW, false).shouldCompact).toBe(false);
	});

	it("requires at least 3 data points", () => {
		let state = emptyFireStarterState();
		state = evaluateFireStarter(usage(100_000, 60), state, NOW, false).nextState;
		const out = evaluateFireStarter(usage(120_000, 62), state, NOW, false);
		expect(out.shouldCompact).toBe(false);
		expect(out.nextState.turnDeltas.length).toBe(2);
	});

	it("skips when fill is below minFillPct", () => {
		let state = emptyFireStarterState();
		state = evaluateFireStarter(usage(80_000, 40), state, NOW, false).nextState;
		state = evaluateFireStarter(usage(90_000, 45), state, NOW, false).nextState;
		const out = evaluateFireStarter(usage(100_000, 50), state, NOW, false);
		expect(out.shouldCompact).toBe(false);
	});

	it("skips when last compaction was within minGapMs", () => {
		const recent: FireStarterState = {
			turnDeltas: [100_000, 130_000, 165_000],
			lastCompactionTime: NOW - 1_000,
		};
		const out = evaluateFireStarter(usage(200_000, 80), recent, NOW, false, compactDefaults);
		expect(out.shouldCompact).toBe(false);
	});

	it("skips when compaction is already in flight", () => {
		const state: FireStarterState = {
			turnDeltas: [100_000, 130_000, 165_000],
			lastCompactionTime: 0,
		};
		const out = evaluateFireStarter(usage(200_000, 80), state, NOW, true);
		expect(out.shouldCompact).toBe(false);
	});

	it("skips when burn rate is non-positive (context shrinking)", () => {
		const state: FireStarterState = {
			turnDeltas: [200_000, 180_000, 160_000],
			lastCompactionTime: 0,
		};
		const out = evaluateFireStarter(usage(140_000, 70), state, NOW, false);
		expect(out.shouldCompact).toBe(false);
	});

	it("compacts when projected turns-to-full < turnsAhead", () => {
		// Window of 4 turns: 100k, 130k, 160k, 190k → avg delta 30k/turn.
		// Current 190k of 200k window → remaining 10k → projection 0.33 turns.
		const state: FireStarterState = {
			turnDeltas: [100_000, 130_000, 160_000],
			lastCompactionTime: 0,
		};
		const out = evaluateFireStarter(usage(190_000, 95, 200_000), state, NOW, false);
		expect(out.shouldCompact).toBe(true);
		expect(out.nextState.lastCompactionTime).toBe(NOW);
	});

	it("does NOT compact when projected turns-to-full >= turnsAhead", () => {
		// Slow burn: avg delta ~3k/turn, remaining 60k → projection 20 turns.
		const state: FireStarterState = {
			turnDeltas: [100_000, 103_000, 106_000],
			lastCompactionTime: 0,
		};
		const out = evaluateFireStarter(usage(140_000, 70, 200_000), state, NOW, false);
		expect(out.shouldCompact).toBe(false);
	});

	it("rolling deltas window is capped at 6", () => {
		let state = emptyFireStarterState();
		for (let i = 0; i < 12; i++) {
			state = evaluateFireStarter(usage(100_000 + i * 1000, 60), state, NOW, false).nextState;
		}
		expect(state.turnDeltas.length).toBe(6);
	});

	it("honors custom thresholds", () => {
		const state: FireStarterState = {
			turnDeltas: [100_000, 130_000, 160_000],
			lastCompactionTime: 0,
		};
		// With turnsAhead=10, the same scenario that compacts under defaults
		// (projection 0.33) is still under 10 so still compacts. Use a tighter
		// minFillPct to suppress instead.
		const out = evaluateFireStarter(usage(190_000, 95, 200_000), state, NOW, false, {
			minGapMs: 60_000,
			turnsAhead: 3,
			minFillPct: 99,
		});
		expect(out.shouldCompact).toBe(false);
	});
});
