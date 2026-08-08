/**
 * #159 — `mewrite history` command tests.
 *
 * Tests command wiring and resume command formatting without launching a real TUI.
 */

import { describe, expect, it } from "vitest";
import { formatResumeCommand, handleHistoryCommand, printHelp } from "../../../src/cli/history.js";

describe("mewrite history (#159)", () => {
	describe("handleHistoryCommand", () => {
		it("returns false for non-history commands", async () => {
			expect(await handleHistoryCommand(["agents"])).toBe(false);
			expect(await handleHistoryCommand(["serve"])).toBe(false);
			expect(await handleHistoryCommand(["sessions"])).toBe(false);
			expect(await handleHistoryCommand(["h"])).toBe(false);
			expect(await handleHistoryCommand([])).toBe(false);
		});

		// Note: Testing the true case (when args[0] === "history") would require
		// mocking process.exit since handleHistoryCommand calls process.exit after
		// runHistory completes. Avoid spawning TUI in tests.
	});

	describe("formatResumeCommand", () => {
		it("formats absolute path correctly", () => {
			const path = "/Users/test/.mewrite/sessions/proj-123/2024-01-01_abc123.jsonl";
			expect(formatResumeCommand(path)).toBe(`mewrite --resume ${path}`);
		});

		it("formats relative path correctly", () => {
			const path = ".mewrite/sessions/proj-123/2024-01-01_abc123.jsonl";
			expect(formatResumeCommand(path)).toBe(`mewrite --resume ${path}`);
		});

		it("handles paths with spaces", () => {
			const path = "/Users/test/my project/.mewrite/sessions/abc.jsonl";
			expect(formatResumeCommand(path)).toBe(`mewrite --resume ${path}`);
		});
	});

	describe("printHelp", () => {
		it("does not throw", () => {
			expect(() => printHelp()).not.toThrow();
		});
	});
});
