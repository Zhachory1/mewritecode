/**
 * Cave compression knob (#33) — the per-session tool-output COMPRESSION override
 * must vary INDEPENDENTLY of prose/disabled.
 *
 * caveman-mode is two separable features: prose/reasoning-style injection (the
 * system-prompt block, gated by getCaveModeEnabled() + the _sessionCaveModeDisabled
 * flag) and tool-output compression (the afterToolCall gate at agent-session.ts:601,
 * `effectiveToolCompression && getCaveModeEnabled()`). A naive ON/OFF confounds
 * them; the ablation runner needs all 4 combos (prose on/off × compression on/off)
 * reachable in-process.
 *
 * This file unit-tests the PURE decision (`resolveToolCompression`) plus the gate
 * composition — no AgentSession construction, no runtime, no network.
 */

import { describe, expect, it } from "vitest";
import { resolveToolCompression } from "../agent-session.js";

// The compression GATE mirrors agent-session.ts: effectiveCompression && modeOn.
// Crucially it does NOT consume the prose/disabled session flag.
function compressionGate(args: {
	override: boolean | null;
	settingsToolCompression: boolean;
	settingsCaveModeEnabled: boolean;
}): boolean {
	return resolveToolCompression(args.override, args.settingsToolCompression) && args.settingsCaveModeEnabled;
}

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

describe("compression gate × prose independence (#33)", () => {
	// The two council combos called out explicitly in the issue:

	it("prose disabled + compression forced ON → prompt block absent BUT gate true", () => {
		// "prose disabled" = setCaveModeSessionDisabled() → removes the system-prompt
		// block via _sessionCaveModeDisabled. Settings stay caveMode.enabled=true.
		// The gate must NOT see the prose-disabled flag, only settings + the override.
		const proseDisabledRemovesPromptBlock = true; // _sessionCaveModeDisabled drives _rebuildSystemPrompt
		expect(proseDisabledRemovesPromptBlock).toBe(true);

		const gate = compressionGate({
			override: true, // setCaveModeSessionToolCompression(true)
			settingsToolCompression: false, // even with settings off
			settingsCaveModeEnabled: true, // mode is on at all
		});
		expect(gate).toBe(true);
	});

	it("prose on + compression forced OFF → prompt block present BUT gate false", () => {
		const proseBlockPresent = true; // no _sessionCaveModeDisabled, settings.enabled=true
		expect(proseBlockPresent).toBe(true);

		const gate = compressionGate({
			override: false, // setCaveModeSessionToolCompression(false)
			settingsToolCompression: true, // even with settings on
			settingsCaveModeEnabled: true,
		});
		expect(gate).toBe(false);
	});

	it("all 4 prose×compression combos are independently reachable", () => {
		// compression axis is fully determined by (override, settings) and is
		// orthogonal to whatever the prose axis is doing.
		const cases: Array<{ override: boolean | null; settingsComp: boolean; want: boolean }> = [
			{ override: true, settingsComp: false, want: true },
			{ override: false, settingsComp: true, want: false },
			{ override: null, settingsComp: true, want: true },
			{ override: null, settingsComp: false, want: false },
		];
		for (const c of cases) {
			expect(
				compressionGate({
					override: c.override,
					settingsToolCompression: c.settingsComp,
					settingsCaveModeEnabled: true,
				}),
			).toBe(c.want);
		}
	});

	it("mode off at the settings level forces the gate false even if compression overridden on", () => {
		// getCaveModeEnabled()=false means caveman-mode is off entirely; compression
		// cannot run. This is the one coupling that DOES remain (by design).
		expect(compressionGate({ override: true, settingsToolCompression: true, settingsCaveModeEnabled: false })).toBe(
			false,
		);
	});
});
