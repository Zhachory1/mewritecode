import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS, isUnwiredBuiltinCommand } from "../src/core/slash-commands.js";

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

	test("only temporarily-disabled builtins are unwired", () => {
		const unwired = BUILTIN_SLASH_COMMANDS.filter((c) => !c.wired).map((c) => c.name);
		expect(unwired).toEqual(["activity"]);
		for (const c of BUILTIN_SLASH_COMMANDS) {
			expect(isUnwiredBuiltinCommand(c.name)).toBe(c.name === "activity");
		}
	});

	test("isUnwiredBuiltinCommand fires for a wired:false entry (gate is live)", () => {
		const fixture = [
			{ name: "shipped", description: "has a dispatch branch", wired: true },
			{ name: "stub", description: "registered but not wired in this build", wired: false },
		];
		expect(isUnwiredBuiltinCommand("stub", fixture)).toBe(true);
		expect(isUnwiredBuiltinCommand("shipped", fixture)).toBe(false);
		expect(isUnwiredBuiltinCommand("absent", fixture)).toBe(false);
	});
});
