import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";

describe("BUILTIN_SLASH_COMMANDS wired flag", () => {
	test("every entry declares a boolean wired flag", () => {
		for (const c of BUILTIN_SLASH_COMMANDS) {
			expect(typeof c.wired, `command "${c.name}" should declare wired`).toBe("boolean");
		}
	});

	test("a /help command is registered and wired", () => {
		const help = BUILTIN_SLASH_COMMANDS.find((c) => c.name === "help");
		expect(help, "/help should be registered").toBeDefined();
		expect(help?.wired).toBe(true);
	});
});
