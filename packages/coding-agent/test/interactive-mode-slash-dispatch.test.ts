import { describe, expect, it } from "vitest";
import { classifySafeInteractiveSlashCommand } from "../src/modes/interactive/slash-dispatch.js";

describe("classifySafeInteractiveSlashCommand", () => {
	it("classifies exact safe commands", () => {
		expect(classifySafeInteractiveSlashCommand("/logout")).toEqual({ kind: "logout" });
		expect(classifySafeInteractiveSlashCommand("/new")).toEqual({ kind: "clear" });
		expect(classifySafeInteractiveSlashCommand("/clear")).toEqual({ kind: "clear" });
		expect(classifySafeInteractiveSlashCommand("/compact")).toEqual({ kind: "compact", instructions: undefined });
		expect(classifySafeInteractiveSlashCommand("/freeze")).toEqual({ kind: "freeze", label: undefined });
	});

	it("trims outer command whitespace and command arguments", () => {
		expect(classifySafeInteractiveSlashCommand("  /compact   summarize only active task  ")).toEqual({
			kind: "compact",
			instructions: "summarize only active task",
		});
		expect(classifySafeInteractiveSlashCommand("  /freeze   release prep  ")).toEqual({
			kind: "freeze",
			label: "release prep",
		});
	});

	it("requires command boundaries", () => {
		for (const input of [
			"/logout foo",
			"/new x",
			"/clear x",
			"/compactness",
			"/freeze-dry",
			"/login",
			"/login anthropic",
			"/loginx",
			"/some-extension",
			"plain prompt",
			"",
		]) {
			expect(classifySafeInteractiveSlashCommand(input), input).toBeNull();
		}
	});
});
