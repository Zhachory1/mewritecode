import { describe, expect, it } from "vitest";
import { splitOnThen } from "../src/core/command-queue.js";

describe("splitOnThen", () => {
	it("returns the original (trimmed) text when no /then is present", () => {
		expect(splitOnThen("/goal write tests")).toEqual(["/goal write tests"]);
		expect(splitOnThen("  /goal write tests  ")).toEqual(["/goal write tests"]);
	});

	it("returns empty array for blank input", () => {
		expect(splitOnThen("")).toEqual([]);
		expect(splitOnThen("   \n   ")).toEqual([]);
	});

	it("splits on a single /then separator", () => {
		expect(splitOnThen("/writing-plans /then /goal implement until tests are green")).toEqual([
			"/writing-plans",
			"/goal implement until tests are green",
		]);
	});

	it("splits on multiple /then separators", () => {
		expect(splitOnThen("/a /then /b /then /c")).toEqual(["/a", "/b", "/c"]);
	});

	it("preserves prose around commands", () => {
		expect(splitOnThen("/writing-plans for the auth module /then /goal ship it")).toEqual([
			"/writing-plans for the auth module",
			"/goal ship it",
		]);
	});

	it("does NOT split on prose 'then' without leading slash", () => {
		expect(splitOnThen("first do X then write tests")).toEqual(["first do X then write tests"]);
	});

	it("does NOT split on /then that is not followed by another /command", () => {
		// User clearly meant the word "then" — no following slash token to chain to.
		expect(splitOnThen("/goal do the thing /then write the docs")).toEqual([
			"/goal do the thing /then write the docs",
		]);
	});

	it("does NOT split on /then inside fenced code blocks", () => {
		const input = "/explain ```\nrun: /a /then /b\n``` /then /goal next";
		expect(splitOnThen(input)).toEqual(["/explain ```\nrun: /a /then /b\n```", "/goal next"]);
	});

	it("does NOT split on /then inside inline backticks", () => {
		expect(splitOnThen("/note `also see: /a /then /b` /then /goal go")).toEqual([
			"/note `also see: /a /then /b`",
			"/goal go",
		]);
	});

	it("requires /then at a word boundary (no prefix glue)", () => {
		// "fluffy/then" is not a separator: there is no whitespace/start before the slash.
		expect(splitOnThen("fluffy/then /goal nope")).toEqual(["fluffy/then /goal nope"]);
	});

	it("trims whitespace around each fragment", () => {
		expect(splitOnThen("   /a   /then   /b   ")).toEqual(["/a", "/b"]);
	});

	it("handles unterminated fenced code defensively (no split inside)", () => {
		// Unterminated fence: everything after the ``` is treated as code-region prose,
		// so the /then inside is NOT a separator.
		expect(splitOnThen("/explain ```still typing /then /goal x")).toEqual(["/explain ```still typing /then /goal x"]);
	});
});
