import { describe, expect, test } from "vitest";
import { parseLoginCommand } from "../src/modes/interactive/interactive-mode.js";

const valid = [
	{ id: "anthropic", aliases: ["claude"] },
	{ id: "openai-codex", aliases: ["chatgpt"] },
	{ id: "github-copilot", aliases: ["copilot"] },
];

describe("parseLoginCommand", () => {
	test("bare /login opens the selector", () => {
		expect(parseLoginCommand("/login", valid)).toEqual({ kind: "selector" });
	});

	test("/login with trailing whitespace opens the selector", () => {
		expect(parseLoginCommand("/login ", valid)).toEqual({ kind: "selector" });
		expect(parseLoginCommand("/login   ", valid)).toEqual({ kind: "selector" });
	});

	test("/login <raw id> routes to that provider", () => {
		expect(parseLoginCommand("/login anthropic", valid)).toEqual({ kind: "provider", provider: "anthropic" });
		expect(parseLoginCommand("/login openai-codex", valid)).toEqual({
			kind: "provider",
			provider: "openai-codex",
		});
		expect(parseLoginCommand("/login github-copilot", valid)).toEqual({
			kind: "provider",
			provider: "github-copilot",
		});
	});

	test("/login <friendly alias> resolves to the canonical id", () => {
		expect(parseLoginCommand("/login claude", valid)).toEqual({ kind: "provider", provider: "anthropic" });
		expect(parseLoginCommand("/login copilot", valid)).toEqual({ kind: "provider", provider: "github-copilot" });
	});

	test("alias resolution is case-insensitive", () => {
		expect(parseLoginCommand("/login CHATGPT", valid)).toEqual({ kind: "provider", provider: "openai-codex" });
	});

	test("/login <unknown provider> is invalid", () => {
		expect(parseLoginCommand("/login bogus", valid)).toEqual({ kind: "invalid", provider: "bogus" });
	});

	test("trims surrounding whitespace around the provider arg", () => {
		expect(parseLoginCommand("/login  claude  ", valid)).toEqual({ kind: "provider", provider: "anthropic" });
	});
});
