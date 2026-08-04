/**
 * Regression: TUI freeze during model streaming.
 *
 * A finished markdown code block is re-rendered on every frame while later
 * content keeps streaming. Without memoization each frame re-runs the
 * CPU-bound cli-highlight pass over every code block, which is O(N^2) across a
 * long response and stalls the single-threaded TUI loop (the "freeze").
 *
 * getMarkdownTheme().highlightCode must return a memoized (referentially
 * identical) result for repeated identical (code, lang) calls, and must
 * invalidate that memo when the active theme changes so colors stay correct.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { getMarkdownTheme, initTheme, setTheme } from "../src/modes/interactive/theme/theme.js";

describe("markdown highlightCode memoization", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("returns the same array instance for repeated identical calls", () => {
		const { highlightCode } = getMarkdownTheme();
		if (!highlightCode) throw new Error("highlightCode not defined");
		const code = "const x = 1;\nconst y = 2;";
		const first = highlightCode(code, "typescript");
		const second = highlightCode(code, "typescript");
		// Same reference → the second frame skipped the highlight pass entirely.
		expect(second).toBe(first);
	});

	test("does not memoize across different code or language", () => {
		const { highlightCode } = getMarkdownTheme();
		if (!highlightCode) throw new Error("highlightCode not defined");
		const a = highlightCode("const x = 1;", "typescript");
		const b = highlightCode("const x = 2;", "typescript");
		expect(b).not.toBe(a);
	});

	test("invalidates the memo when the theme changes", () => {
		const { highlightCode } = getMarkdownTheme();
		if (!highlightCode) throw new Error("highlightCode not defined");
		const code = "const z = 3;";
		const before = highlightCode(code, "typescript");
		// Switch to a different builtin theme; highlight colors depend on it.
		setTheme("light");
		const afterSwitch = highlightCode(code, "typescript");
		// Cache was cleared → fresh array (not the stale, wrong-theme one).
		expect(afterSwitch).not.toBe(before);
		// Restore default so other tests are unaffected.
		setTheme("dark");
	});
});
