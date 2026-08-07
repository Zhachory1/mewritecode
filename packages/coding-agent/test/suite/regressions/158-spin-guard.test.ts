/**
 * #158 — daemon spin guard.
 *
 * A self-perpetuating error must not spin the daemon at 100% CPU forever; the guard
 * trips once errors exceed a threshold within a window so the daemon can restart.
 */

import { describe, expect, it } from "vitest";
import { SpinGuard } from "../../../src/core/daemon/spin-guard.js";

describe("#158 SpinGuard", () => {
	it("does not trip for occasional errors within the window", () => {
		let now = 0;
		const g = new SpinGuard(5, 1000, () => now);
		for (let i = 0; i < 4; i++) {
			now += 10;
			expect(g.record()).toBe(false);
		}
		expect(g.count).toBe(4);
	});

	it("trips once when errors exceed the threshold within the window", () => {
		let now = 0;
		const g = new SpinGuard(5, 1000, () => now);
		const trips: boolean[] = [];
		for (let i = 0; i < 6; i++) {
			now += 10;
			trips.push(g.record());
		}
		// Trips exactly once, on the 5th error.
		expect(trips).toEqual([false, false, false, false, true, false]);
	});

	it("drops errors that age out of the window (slow trickle never trips)", () => {
		let now = 0;
		const g = new SpinGuard(3, 1000, () => now);
		for (let i = 0; i < 10; i++) {
			now += 500; // 500ms apart: at most 2 ever inside a 1000ms window
			expect(g.record()).toBe(false);
		}
	});
});
