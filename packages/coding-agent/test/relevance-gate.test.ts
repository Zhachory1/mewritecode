import { describe, expect, test } from "vitest";
import { RelevanceGate } from "../src/core/relevance-gate.js";

describe("RelevanceGate", () => {
	test("bootstrap: always injects until minSamples scores recorded", () => {
		const gate = new RelevanceGate({ minSamples: 4 });
		expect(gate.shouldInject(0)).toBe(true);
		expect(gate.shouldInject(0)).toBe(true);
		expect(gate.shouldInject(0)).toBe(true);
		expect(gate.shouldInject(0)).toBe(true);
	});

	test("gates on p75 once calibrated: low score after a run of high scores is skipped", () => {
		const gate = new RelevanceGate({ minSamples: 4, windowSize: 20 });
		for (const s of [10, 10, 10, 10]) gate.shouldInject(s);
		expect(gate.shouldInject(1)).toBe(false);
		expect(gate.shouldInject(10)).toBe(true);
	});

	test("rolling window drops old scores so the threshold adapts", () => {
		const gate = new RelevanceGate({ minSamples: 2, windowSize: 3 });
		gate.shouldInject(10);
		gate.shouldInject(10);
		// Push low scores through the window until the high scores age out.
		gate.shouldInject(1);
		gate.shouldInject(1);
		gate.shouldInject(1);
		// Window is now [1,1,1] — p75 of a flat series is 1, so a 1 passes.
		expect(gate.shouldInject(1)).toBe(true);
	});
});
