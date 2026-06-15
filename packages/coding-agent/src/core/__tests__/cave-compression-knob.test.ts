/**
 * Cave compression knob (#33) — the per-session tool-output COMPRESSION override
 * must vary INDEPENDENTLY of prose/disabled so the 2×2 (prose × compression) is
 * REACHABLE.
 *
 * caveman-mode is two separable features: prose/reasoning-style injection (the
 * system-prompt block, gated by getCaveModeEnabled() + the _sessionCaveModeDisabled
 * flag) and tool-output compression (the afterToolCall gate). Before the decoupling,
 * prose-off forced compression off (the gate ANDed getCaveModeEnabled(), and
 * `--cave off` sets settings.enabled=false), so "compression-only" (prose off +
 * compression on) was UNREACHABLE. The fix: an explicit per-session compression
 * override FULLY determines the gate, decoupled from BOTH the prose/disabled flag
 * AND getCaveModeEnabled(). Only a null override falls back to the old coupled
 * `toolCompression && getCaveModeEnabled()`.
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
// Pure decision — the override-vs-settings truth table (now full gate).
// ---------------------------------------------------------------------------

describe("resolveToolCompression (pure)", () => {
	it("null override falls back to settingsToolCompression && caveModeEnabled (both on → on)", () => {
		expect(resolveToolCompression(null, true, true)).toBe(true);
	});

	it("null override + settings compression off → off", () => {
		expect(resolveToolCompression(null, false, true)).toBe(false);
	});

	it("null override + mode disabled → off (the coupled fallback)", () => {
		expect(resolveToolCompression(null, true, false)).toBe(false);
	});

	it("override true forces compression on regardless of settings OR mode-enabled", () => {
		expect(resolveToolCompression(true, false, false)).toBe(true);
	});

	it("override false forces compression off regardless of settings OR mode-enabled", () => {
		expect(resolveToolCompression(false, true, true)).toBe(false);
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

describe("getEffectiveCaveCompressionGate × prose independence (#33) — the REACHABLE 2×2", () => {
	// The four council-required combos on the REAL gate. "prose off" is modeled the
	// way run-swebench does it: setCaveModeEnabled(false) at the settings level (so
	// getCaveModeEnabled()=false). Before the decoupling, that forced the gate false
	// regardless of the override — making "compression-only" unreachable. With the
	// override decoupled, all four are reachable.

	it("prose OFF + compression override ON → gate TRUE (compression-only is now reachable)", () => {
		const h = makeGateHarness({
			settingsToolCompression: false,
			settingsCaveModeEnabled: false, // prose off ⇒ mode disabled at settings
			proseDisabled: true,
		});
		h.setOverride(true);
		expect(h.gate()).toBe(true);
	});

	it("prose OFF + compression override OFF → gate FALSE", () => {
		const h = makeGateHarness({
			settingsToolCompression: true,
			settingsCaveModeEnabled: false,
			proseDisabled: true,
		});
		h.setOverride(false);
		expect(h.gate()).toBe(false);
	});

	it("prose FULL + compression override ON → gate TRUE", () => {
		const h = makeGateHarness({
			settingsToolCompression: false, // override wins regardless of settings
			settingsCaveModeEnabled: true,
			proseDisabled: false,
		});
		h.setOverride(true);
		expect(h.gate()).toBe(true);
	});

	it("prose FULL + compression override OFF → gate FALSE", () => {
		const h = makeGateHarness({
			settingsToolCompression: true,
			settingsCaveModeEnabled: true,
			proseDisabled: false,
		});
		h.setOverride(false);
		expect(h.gate()).toBe(false);
	});

	it("NO override preserves the old coupled behavior: prose off (mode disabled) → gate false", () => {
		const h = makeGateHarness({
			settingsToolCompression: true, // settings want compression on…
			settingsCaveModeEnabled: false, // …but mode is disabled (prose off)
			proseDisabled: true,
		});
		// no setOverride → override stays null → coupled fallback applies
		expect(h.gate()).toBe(false);
	});

	it("NO override, mode enabled + settings compression on → gate true (coupled fallback)", () => {
		const h = makeGateHarness({
			settingsToolCompression: true,
			settingsCaveModeEnabled: true,
		});
		expect(h.gate()).toBe(true);
	});

	it("an explicit override is independent of the prose-disabled flag at every setting", () => {
		for (const proseDisabled of [false, true]) {
			for (const override of [true, false] as boolean[]) {
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
				// and the override fully determines the gate.
				expect(enabled.gate()).toBe(override);
			}
		}
	});
});
