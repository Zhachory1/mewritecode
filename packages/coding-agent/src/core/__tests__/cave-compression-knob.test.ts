/**
 * Cave compression knob (#33) — the per-session tool-output COMPRESSION override
 * must vary INDEPENDENTLY of prose/disabled.
 *
 * caveman-mode is two separable features: prose/reasoning-style injection (the
 * system-prompt block, gated by getCaveModeEnabled() + the _sessionCaveModeDisabled
 * flag) and tool-output compression (the afterToolCall gate at agent-session.ts:627,
 * `effectiveToolCompression && getCaveModeEnabled()`). A naive ON/OFF confounds
 * them; the ablation runner needs all 4 combos (prose on/off × compression on/off)
 * reachable in-process.
 *
 * This file unit-tests the PURE decision (`resolveToolCompression`) AND the REAL
 * session gate accessor (`getEffectiveCaveCompressionGate`) plus its real
 * per-session setter (`setCaveModeSessionToolCompression`). A full AgentSession
 * (agent runtime, tool wiring, network) is far too heavy for a unit test, so we
 * invoke the genuine prototype methods against a minimal `this` carrying exactly
 * the fields they read — the settings manager + the per-session override field.
 * This exercises the SHIPPING gate code, not a re-implementation of it.
 */

import { describe, expect, it } from "vitest";
import { AgentSession, resolveToolCompression } from "../agent-session.js";

// ---------------------------------------------------------------------------
// Pure decision — the override-vs-settings truth table.
// ---------------------------------------------------------------------------

describe("resolveToolCompression (pure)", () => {
	it("null override falls back to the settings value (on)", () => {
		expect(resolveToolCompression(null, true)).toBe(true);
	});

	it("null override falls back to the settings value (off)", () => {
		expect(resolveToolCompression(null, false)).toBe(false);
	});

	it("override true forces compression on regardless of settings", () => {
		expect(resolveToolCompression(true, false)).toBe(true);
	});

	it("override false forces compression off regardless of settings", () => {
		expect(resolveToolCompression(false, true)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// REAL session gate — exercises AgentSession.prototype methods directly.
// ---------------------------------------------------------------------------

/**
 * Build a minimal `this` for the real AgentSession gate methods. The accessors
 * under test (`getEffectiveCaveCompressionGate`, `_effectiveToolCompression`,
 * `setCaveModeSessionToolCompression`) read ONLY `_sessionToolCompressionOverride`
 * and two SettingsManager getters — so a stub carrying those is sufficient to
 * drive the genuine prototype logic without constructing a full session.
 */
function makeGateHarness(args: {
	settingsToolCompression: boolean;
	settingsCaveModeEnabled: boolean;
	/** simulates an interactive prose-disable (setCaveModeSessionDisabled). */
	proseDisabled?: boolean;
}) {
	// Back the stub with the REAL AgentSession.prototype so the genuine methods
	// (and the private `_effectiveToolCompression` they call through `this`) run
	// against exactly the fields they read. The private fields force a cast
	// through `unknown` to a structural view exposing just what we touch.
	type GateView = {
		_sessionToolCompressionOverride: boolean | null;
		_sessionCaveModeDisabled: boolean;
		settingsManager: { getCaveModeToolCompression: () => boolean; getCaveModeEnabled: () => boolean };
		setCaveModeSessionToolCompression: (v: boolean | null) => void;
		getEffectiveCaveCompressionGate: () => boolean;
	};
	const self = Object.create(AgentSession.prototype) as unknown as GateView;
	self._sessionToolCompressionOverride = null;
	self._sessionCaveModeDisabled = args.proseDisabled ?? false;
	self.settingsManager = {
		getCaveModeToolCompression: () => args.settingsToolCompression,
		getCaveModeEnabled: () => args.settingsCaveModeEnabled,
	};
	return {
		setOverride: (v: boolean | null) => self.setCaveModeSessionToolCompression(v),
		gate: () => self.getEffectiveCaveCompressionGate(),
	};
}

describe("getEffectiveCaveCompressionGate × prose independence (#33)", () => {
	// The two council combos called out explicitly in the issue, driven through
	// the REAL accessor (not a local mirror):

	it("prose disabled + compression forced ON → gate true (prose flag does not gate compression)", () => {
		// "prose disabled" = setCaveModeSessionDisabled() in real use; here the
		// _sessionCaveModeDisabled field is set so we prove the gate ignores it.
		const h = makeGateHarness({
			settingsToolCompression: false, // even with settings compression off
			settingsCaveModeEnabled: true, // mode is on at all
			proseDisabled: true,
		});
		h.setOverride(true); // setCaveModeSessionToolCompression(true)
		expect(h.gate()).toBe(true);
	});

	it("prose on + compression forced OFF → gate false", () => {
		const h = makeGateHarness({
			settingsToolCompression: true, // even with settings compression on
			settingsCaveModeEnabled: true,
			proseDisabled: false,
		});
		h.setOverride(false); // setCaveModeSessionToolCompression(false)
		expect(h.gate()).toBe(false);
	});

	it("all 4 (override × settings) combos are reachable through the real gate", () => {
		const cases: Array<{ override: boolean | null; settingsComp: boolean; want: boolean }> = [
			{ override: true, settingsComp: false, want: true },
			{ override: false, settingsComp: true, want: false },
			{ override: null, settingsComp: true, want: true },
			{ override: null, settingsComp: false, want: false },
		];
		for (const c of cases) {
			const h = makeGateHarness({ settingsToolCompression: c.settingsComp, settingsCaveModeEnabled: true });
			h.setOverride(c.override);
			expect(h.gate()).toBe(c.want);
		}
	});

	it("the gate is independent of the prose-disabled flag at every override setting", () => {
		for (const proseDisabled of [false, true]) {
			for (const override of [true, false, null] as Array<boolean | null>) {
				const enabled = makeGateHarness({
					settingsToolCompression: true,
					settingsCaveModeEnabled: true,
					proseDisabled,
				});
				enabled.setOverride(override);
				const disabled = makeGateHarness({
					settingsToolCompression: true,
					settingsCaveModeEnabled: true,
					proseDisabled: !proseDisabled,
				});
				disabled.setOverride(override);
				// flipping ONLY the prose flag must not change the compression gate.
				expect(enabled.gate()).toBe(disabled.gate());
			}
		}
	});

	it("mode off at the settings level forces the gate false even if compression overridden on", () => {
		// getCaveModeEnabled()=false means caveman-mode is off entirely; compression
		// cannot run. This is the one coupling that DOES remain (by design).
		const h = makeGateHarness({ settingsToolCompression: true, settingsCaveModeEnabled: false });
		h.setOverride(true);
		expect(h.gate()).toBe(false);
	});
});
