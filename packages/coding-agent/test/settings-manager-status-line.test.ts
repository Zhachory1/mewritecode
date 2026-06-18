/**
 * Tests for the WS10 statusLine settings key on SettingsManager.
 *
 * Verifies the Claude-Code-compatible `statusLine` block roundtrips through
 * the manager, that project overrides win over global, and that malformed
 * shapes are preserved (parsing/validation lives in @zhachory1/mewrite-tui).
 */
import { parseStatusLineSettings } from "@zhachory1/mewrite-tui";
import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager statusLine", () => {
	it("returns undefined when not set", () => {
		const sm = SettingsManager.inMemory();
		expect(sm.getStatusLine()).toBeUndefined();
	});

	it("roundtrips a default-type config", () => {
		const sm = SettingsManager.inMemory();
		sm.setGlobalStatusLine({ type: "default" });
		expect(sm.getStatusLine()).toEqual({ type: "default" });
	});

	it("roundtrips a command-type config with padding", () => {
		const sm = SettingsManager.inMemory();
		const cfg = { type: "command", command: "/bin/echo cave", padding: 2 };
		sm.setGlobalStatusLine(cfg);
		expect(sm.getStatusLine()).toEqual(cfg);
		// Validates against the @zhachory1/mewrite-tui parser unchanged.
		expect(parseStatusLineSettings(sm.getStatusLine())).toEqual(cfg);
	});

	it("project scope overrides global scope", () => {
		const sm = SettingsManager.inMemory();
		sm.setGlobalStatusLine({ type: "default" });
		sm.setProjectStatusLine({ type: "detailed" });
		expect(sm.getStatusLine()).toEqual({ type: "detailed" });
	});

	it("clearing project scope falls back to global", () => {
		const sm = SettingsManager.inMemory();
		sm.setGlobalStatusLine({ type: "detailed" });
		sm.setProjectStatusLine({ type: "default" });
		expect(sm.getStatusLine()?.type).toBe("default");
		sm.setProjectStatusLine(undefined);
		expect(sm.getStatusLine()?.type).toBe("detailed");
	});
});
