import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	expandHomePath,
	formatContextSetupHelp,
	formatContextSetupNotice,
	formatContextSetupStatus,
	shouldShowContextSetupNotice,
	validateSetupDir,
} from "../src/core/context-setup.js";
import { SettingsManager } from "../src/core/settings-manager.js";

function tempDir(): string {
	const dir = join(tmpdir(), `context-setup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("context setup", () => {
	it("shows notice only before setup is seen or configured", () => {
		expect(shouldShowContextSetupNotice({ hasSeenSetupPrompt: false })).toBe(true);
		expect(shouldShowContextSetupNotice({ hasSeenSetupPrompt: true })).toBe(false);
		expect(shouldShowContextSetupNotice({ hasSeenSetupPrompt: false, mainDocsDir: "/tmp/docs" })).toBe(false);
	});

	it("formats one-time notice and help", () => {
		expect(formatContextSetupNotice()).toContain("Optional context setup");
		expect(formatContextSetupNotice()).toContain("/context setup skip");
		expect(formatContextSetupHelp("/repo")).toContain("/context setup docs-dir <path>");
	});

	it("validates directories", () => {
		const dir = tempDir();
		const file = join(dir, "file.txt");
		writeFileSync(file, "x");

		expect(validateSetupDir(dir)).toEqual({ ok: true, path: dir });
		expect(validateSetupDir(file)).toMatchObject({ ok: false });
		expect(validateSetupDir(join(dir, "missing"))).toMatchObject({ ok: false });
	});

	it("expands home paths", () => {
		expect(expandHomePath("~")).not.toBe("~");
		expect(expandHomePath("~/notes")).not.toContain("~");
	});

	it("formats status with next actions and no content", () => {
		const lines = formatContextSetupStatus({
			hasSeenSetupPrompt: true,
			mainDocsDir: "/Users/test/docs",
		});

		expect(lines.join("\n")).toContain("qmd collection add");
		expect(lines.join("\n")).not.toContain("Codescry");
		expect(lines.join("\n")).toContain("Headroom: built-in integration");
	});

	it("persists setup state in settings manager", () => {
		const settings = SettingsManager.inMemory();
		settings.setContextSetupSettings({ hasSeenSetupPrompt: true, mainDocsDir: "/tmp/docs" });

		expect(settings.getContextSetupSettings()).toMatchObject({
			hasSeenSetupPrompt: true,
			mainDocsDir: "/tmp/docs",
		});
	});
});
