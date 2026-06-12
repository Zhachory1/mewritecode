import { describe, expect, test } from "vitest";
import { parseLoginCommand } from "../src/modes/interactive/interactive-mode.js";

const valid = ["anthropic", "openai", "github-copilot"];

describe("parseLoginCommand", () => {
	test("bare /login opens the selector", () => {
		expect(parseLoginCommand("/login", valid)).toEqual({ kind: "selector" });
	});

	test("/login with trailing whitespace opens the selector", () => {
		expect(parseLoginCommand("/login ", valid)).toEqual({ kind: "selector" });
		expect(parseLoginCommand("/login   ", valid)).toEqual({ kind: "selector" });
	});

	test("/login <valid provider> routes to that provider", () => {
		expect(parseLoginCommand("/login anthropic", valid)).toEqual({ kind: "provider", provider: "anthropic" });
		expect(parseLoginCommand("/login github-copilot", valid)).toEqual({
			kind: "provider",
			provider: "github-copilot",
		});
	});

	test("/login <unknown provider> is invalid", () => {
		expect(parseLoginCommand("/login bogus", valid)).toEqual({ kind: "invalid", provider: "bogus" });
	});

	test("trims surrounding whitespace around the provider arg", () => {
		expect(parseLoginCommand("/login  anthropic  ", valid)).toEqual({ kind: "provider", provider: "anthropic" });
	});
});
