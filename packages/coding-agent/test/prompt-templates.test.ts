/**
 * Tests for prompt template argument parsing and substitution.
 *
 * Tests verify:
 * - Argument parsing with quotes and special characters
 * - Placeholder substitution ($1, $2, $@, $ARGUMENTS)
 * - No recursive substitution of patterns in argument values
 * - Edge cases and integration between parsing and substitution
 */

import { describe, expect, test } from "vitest";
import {
	expandPromptTemplate,
	type PromptTemplate,
	parseCommandArgs,
	substituteArgs,
} from "../src/core/prompt-templates.js";

function makeTemplate(name: string, content: string): PromptTemplate {
	return {
		name,
		content,
		description: "",
		filePath: `/fake/${name}.md`,
		sourceInfo: { source: "local" } as PromptTemplate["sourceInfo"],
	};
}

// ============================================================================
// substituteArgs
// ============================================================================

describe("substituteArgs", () => {
	test("should replace $ARGUMENTS with all args joined", () => {
		expect(substituteArgs("Test: $ARGUMENTS", ["a", "b", "c"])).toBe("Test: a b c");
	});

	test("should replace $@ with all args joined", () => {
		expect(substituteArgs("Test: $@", ["a", "b", "c"])).toBe("Test: a b c");
	});

	test("should replace $@ and $ARGUMENTS identically", () => {
		const args = ["foo", "bar", "baz"];
		expect(substituteArgs("Test: $@", args)).toBe(substituteArgs("Test: $ARGUMENTS", args));
	});

	// CRITICAL: argument values containing patterns should remain literal
	test("should NOT recursively substitute patterns in argument values", () => {
		expect(substituteArgs("$ARGUMENTS", ["$1", "$ARGUMENTS"])).toBe("$1 $ARGUMENTS");
		expect(substituteArgs("$@", ["$100", "$1"])).toBe("$100 $1");
		expect(substituteArgs("$ARGUMENTS", ["$100", "$1"])).toBe("$100 $1");
	});

	test("should support mixed $1, $2, and $ARGUMENTS", () => {
		expect(substituteArgs("$1: $ARGUMENTS", ["prefix", "a", "b"])).toBe("prefix: prefix a b");
	});

	test("should support mixed $1, $2, and $@", () => {
		expect(substituteArgs("$1: $@", ["prefix", "a", "b"])).toBe("prefix: prefix a b");
	});

	test("should handle empty arguments array with $ARGUMENTS", () => {
		expect(substituteArgs("Test: $ARGUMENTS", [])).toBe("Test: ");
	});

	test("should handle empty arguments array with $@", () => {
		expect(substituteArgs("Test: $@", [])).toBe("Test: ");
	});

	test("should handle empty arguments array with $1", () => {
		expect(substituteArgs("Test: $1", [])).toBe("Test: ");
	});

	test("should handle multiple occurrences of $ARGUMENTS", () => {
		expect(substituteArgs("$ARGUMENTS and $ARGUMENTS", ["a", "b"])).toBe("a b and a b");
	});

	test("should handle multiple occurrences of $@", () => {
		expect(substituteArgs("$@ and $@", ["a", "b"])).toBe("a b and a b");
	});

	test("should handle mixed occurrences of $@ and $ARGUMENTS", () => {
		expect(substituteArgs("$@ and $ARGUMENTS", ["a", "b"])).toBe("a b and a b");
	});

	test("should handle special characters in arguments", () => {
		// Note: $100 in argument doesn't get partially matched - full strings are substituted
		expect(substituteArgs("$1 $2: $ARGUMENTS", ["arg100", "@user"])).toBe("arg100 @user: arg100 @user");
	});

	test("should handle out-of-range numbered placeholders", () => {
		// Note: Out-of-range placeholders become empty strings (preserving spaces from template)
		expect(substituteArgs("$1 $2 $3 $4 $5", ["a", "b"])).toBe("a b   ");
	});

	test("should handle unicode characters", () => {
		expect(substituteArgs("$ARGUMENTS", ["日本語", "🎉", "café"])).toBe("日本語 🎉 café");
	});

	test("should preserve newlines and tabs in argument values", () => {
		expect(substituteArgs("$1 $2", ["line1\nline2", "tab\tthere"])).toBe("line1\nline2 tab\tthere");
	});

	test("should handle consecutive dollar patterns", () => {
		expect(substituteArgs("$1$2", ["a", "b"])).toBe("ab");
	});

	test("should handle quoted arguments with spaces", () => {
		expect(substituteArgs("$ARGUMENTS", ["first arg", "second arg"])).toBe("first arg second arg");
	});

	test("should handle single argument with $ARGUMENTS", () => {
		expect(substituteArgs("Test: $ARGUMENTS", ["only"])).toBe("Test: only");
	});

	test("should handle single argument with $@", () => {
		expect(substituteArgs("Test: $@", ["only"])).toBe("Test: only");
	});

	test("should handle $0 (zero index)", () => {
		expect(substituteArgs("$0", ["a", "b"])).toBe("");
	});

	test("should handle decimal number in pattern (only integer part matches)", () => {
		expect(substituteArgs("$1.5", ["a"])).toBe("a.5");
	});

	test("should handle $ARGUMENTS as part of word", () => {
		expect(substituteArgs("pre$ARGUMENTS", ["a", "b"])).toBe("prea b");
	});

	test("should handle $@ as part of word", () => {
		expect(substituteArgs("pre$@", ["a", "b"])).toBe("prea b");
	});

	test("should handle empty arguments in middle of list", () => {
		expect(substituteArgs("$ARGUMENTS", ["a", "", "c"])).toBe("a  c");
	});

	test("should handle trailing and leading spaces in arguments", () => {
		expect(substituteArgs("$ARGUMENTS", ["  leading  ", "trailing  "])).toBe("  leading   trailing  ");
	});

	test("should handle argument containing pattern partially", () => {
		expect(substituteArgs("Prefix $ARGUMENTS suffix", ["ARGUMENTS"])).toBe("Prefix ARGUMENTS suffix");
	});

	test("should handle non-matching patterns", () => {
		expect(substituteArgs("$A $$ $ $ARGS", ["a"])).toBe("$A $$ $ $ARGS");
	});

	test("should handle case variations (case-sensitive)", () => {
		expect(substituteArgs("$arguments $Arguments $ARGUMENTS", ["a", "b"])).toBe("$arguments $Arguments a b");
	});

	test("should handle both syntaxes in same command with same result", () => {
		const args = ["x", "y", "z"];
		const result1 = substituteArgs("$@ and $ARGUMENTS", args);
		const result2 = substituteArgs("$ARGUMENTS and $@", args);
		expect(result1).toBe(result2);
		expect(result1).toBe("x y z and x y z");
	});

	test("should handle very long argument lists", () => {
		const args = Array.from({ length: 100 }, (_, i) => `arg${i}`);
		const result = substituteArgs("$ARGUMENTS", args);
		expect(result).toBe(args.join(" "));
	});

	test("should handle numbered placeholders with single digit", () => {
		expect(substituteArgs("$1 $2 $3", ["a", "b", "c"])).toBe("a b c");
	});

	test("should handle numbered placeholders with multiple digits", () => {
		const args = Array.from({ length: 15 }, (_, i) => `val${i}`);
		expect(substituteArgs("$10 $12 $15", args)).toBe("val9 val11 val14");
	});

	test("should handle escaped dollar signs (literal backslash preserved)", () => {
		// Note: No escape mechanism exists - backslash is treated literally
		expect(substituteArgs("Price: \\$100", [])).toBe("Price: \\");
	});

	test("should handle mixed numbered and wildcard placeholders", () => {
		expect(substituteArgs("$1: $@ ($ARGUMENTS)", ["first", "second", "third"])).toBe(
			"first: first second third (first second third)",
		);
	});

	test("should handle command with no placeholders", () => {
		expect(substituteArgs("Just plain text", ["a", "b"])).toBe("Just plain text");
	});

	test("should handle command with only placeholders", () => {
		expect(substituteArgs("$1 $2 $@", ["a", "b", "c"])).toBe("a b a b c");
	});
});

// ============================================================================
// substituteArgs - Array Slicing (Bash-Style)
// ============================================================================

describe("substituteArgs - array slicing", () => {
	test(`should slice from index (\${@:N})`, () => {
		expect(substituteArgs(`\${@:2}`, ["a", "b", "c", "d"])).toBe("b c d");
		expect(substituteArgs(`\${@:1}`, ["a", "b", "c"])).toBe("a b c");
		expect(substituteArgs(`\${@:3}`, ["a", "b", "c", "d"])).toBe("c d");
	});

	test(`should slice with length (\${@:N:L})`, () => {
		expect(substituteArgs(`\${@:2:2}`, ["a", "b", "c", "d"])).toBe("b c");
		expect(substituteArgs(`\${@:1:1}`, ["a", "b", "c"])).toBe("a");
		expect(substituteArgs(`\${@:3:1}`, ["a", "b", "c", "d"])).toBe("c");
		expect(substituteArgs(`\${@:2:3}`, ["a", "b", "c", "d", "e"])).toBe("b c d");
	});

	test("should handle out of range slices", () => {
		expect(substituteArgs(`\${@:99}`, ["a", "b"])).toBe("");
		expect(substituteArgs(`\${@:5}`, ["a", "b"])).toBe("");
		expect(substituteArgs(`\${@:10:5}`, ["a", "b"])).toBe("");
	});

	test("should handle zero-length slices", () => {
		expect(substituteArgs(`\${@:2:0}`, ["a", "b", "c"])).toBe("");
		expect(substituteArgs(`\${@:1:0}`, ["a", "b"])).toBe("");
	});

	test("should handle length exceeding array", () => {
		expect(substituteArgs(`\${@:2:99}`, ["a", "b", "c"])).toBe("b c");
		expect(substituteArgs(`\${@:1:10}`, ["a", "b"])).toBe("a b");
	});

	test("should process slice before simple $@", () => {
		expect(substituteArgs(`\${@:2} vs $@`, ["a", "b", "c"])).toBe("b c vs a b c");
		expect(substituteArgs(`First: \${@:1:1}, All: $@`, ["x", "y", "z"])).toBe("First: x, All: x y z");
	});

	test("should not recursively substitute slice patterns in args", () => {
		expect(substituteArgs(`\${@:1}`, [`\${@:2}`, "test"])).toBe(`\${@:2} test`);
		expect(substituteArgs(`\${@:2}`, ["a", `\${@:3}`, "c"])).toBe(`\${@:3} c`);
	});

	test("should handle mixed usage with positional args", () => {
		expect(substituteArgs(`$1: \${@:2}`, ["cmd", "arg1", "arg2"])).toBe("cmd: arg1 arg2");
		expect(substituteArgs(`$1 $2 \${@:3}`, ["a", "b", "c", "d"])).toBe("a b c d");
	});

	test(`should treat \${@:0} as all args`, () => {
		expect(substituteArgs(`\${@:0}`, ["a", "b", "c"])).toBe("a b c");
	});

	test("should handle empty args array", () => {
		expect(substituteArgs(`\${@:2}`, [])).toBe("");
		expect(substituteArgs(`\${@:1}`, [])).toBe("");
	});

	test("should handle single arg array", () => {
		expect(substituteArgs(`\${@:1}`, ["only"])).toBe("only");
		expect(substituteArgs(`\${@:2}`, ["only"])).toBe("");
	});

	test("should handle slice in middle of text", () => {
		expect(substituteArgs(`Process \${@:2} with $1`, ["tool", "file1", "file2"])).toBe(
			"Process file1 file2 with tool",
		);
	});

	test("should handle multiple slices in one template", () => {
		expect(substituteArgs(`\${@:1:1} and \${@:2}`, ["a", "b", "c"])).toBe("a and b c");
		expect(substituteArgs(`\${@:1:2} vs \${@:3:2}`, ["a", "b", "c", "d", "e"])).toBe("a b vs c d");
	});

	test("should handle quoted arguments in slices", () => {
		expect(substituteArgs(`\${@:2}`, ["cmd", "first arg", "second arg"])).toBe("first arg second arg");
	});

	test("should handle special characters in sliced args", () => {
		expect(substituteArgs(`\${@:2}`, ["cmd", "$100", "@user", "#tag"])).toBe("$100 @user #tag");
	});

	test("should handle unicode in sliced args", () => {
		expect(substituteArgs(`\${@:1}`, ["日本語", "🎉", "café"])).toBe("日本語 🎉 café");
	});

	test("should combine positional, slice, and wildcard placeholders", () => {
		const template = `Run $1 on \${@:2:2}, then process $@`;
		const args = ["eslint", "file1.ts", "file2.ts", "file3.ts"];
		expect(substituteArgs(template, args)).toBe(
			"Run eslint on file1.ts file2.ts, then process eslint file1.ts file2.ts file3.ts",
		);
	});

	test("should handle slice with no spacing", () => {
		expect(substituteArgs(`prefix\${@:2}suffix`, ["a", "b", "c"])).toBe("prefixb csuffix");
	});

	test("should handle large slice lengths gracefully", () => {
		const args = Array.from({ length: 10 }, (_, i) => `arg${i + 1}`);
		expect(substituteArgs(`\${@:5:100}`, args)).toBe("arg5 arg6 arg7 arg8 arg9 arg10");
	});
});

// ============================================================================
// parseCommandArgs
// ============================================================================

describe("parseCommandArgs", () => {
	test("should parse simple space-separated arguments", () => {
		expect(parseCommandArgs("a b c")).toEqual(["a", "b", "c"]);
	});

	test("should parse quoted arguments with spaces", () => {
		expect(parseCommandArgs('"first arg" second')).toEqual(["first arg", "second"]);
	});

	test("should parse single-quoted arguments", () => {
		expect(parseCommandArgs("'first arg' second")).toEqual(["first arg", "second"]);
	});

	test("should parse mixed quote styles", () => {
		expect(parseCommandArgs('"double" \'single\' "double again"')).toEqual(["double", "single", "double again"]);
	});

	test("should handle empty string", () => {
		expect(parseCommandArgs("")).toEqual([]);
	});

	test("should handle extra spaces", () => {
		expect(parseCommandArgs("a  b   c")).toEqual(["a", "b", "c"]);
	});

	test("should handle tabs as separators", () => {
		expect(parseCommandArgs("a\tb\tc")).toEqual(["a", "b", "c"]);
	});

	test("should handle quoted empty string", () => {
		// Note: Empty quotes are skipped by current implementation
		expect(parseCommandArgs('"" " "')).toEqual([" "]);
	});

	test("should handle arguments with special characters", () => {
		expect(parseCommandArgs("$100 @user #tag")).toEqual(["$100", "@user", "#tag"]);
	});

	test("should handle unicode characters", () => {
		expect(parseCommandArgs("日本語 🎉 café")).toEqual(["日本語", "🎉", "café"]);
	});

	test("should handle newlines in arguments", () => {
		expect(parseCommandArgs('"line1\nline2" second')).toEqual(["line1\nline2", "second"]);
	});

	test("should handle escaped quotes inside quoted strings", () => {
		// Note: This implementation doesn't handle escaped quotes - backslash is literal
		expect(parseCommandArgs('"quoted \\"text\\""')).toEqual(["quoted \\text\\"]);
	});

	test("should handle trailing spaces", () => {
		expect(parseCommandArgs("a b c   ")).toEqual(["a", "b", "c"]);
	});

	test("should handle leading spaces", () => {
		expect(parseCommandArgs("   a b c")).toEqual(["a", "b", "c"]);
	});
});

// ============================================================================
// Integration
// ============================================================================

describe("parseCommandArgs + substituteArgs integration", () => {
	test("should parse and substitute together correctly", () => {
		const input = 'Button "onClick handler" "disabled support"';
		const args = parseCommandArgs(input);
		const template = "Create component $1 with features: $ARGUMENTS";
		const result = substituteArgs(template, args);
		expect(result).toBe("Create component Button with features: Button onClick handler disabled support");
	});

	test("should handle the example from README", () => {
		const input = 'Button "onClick handler" "disabled support"';
		const args = parseCommandArgs(input);
		const template = "Create a React component named $1 with features: $ARGUMENTS";
		const result = substituteArgs(template, args);
		expect(result).toBe(
			"Create a React component named Button with features: Button onClick handler disabled support",
		);
	});

	test("should produce same result with $@ and $ARGUMENTS", () => {
		const args = parseCommandArgs("feature1 feature2 feature3");
		const template1 = "Implement: $@";
		const template2 = "Implement: $ARGUMENTS";
		expect(substituteArgs(template1, args)).toBe(substituteArgs(template2, args));
	});
});

describe("expandPromptTemplate — commands anywhere (#2)", () => {
	const templates = [makeTemplate("writing-plans", "PLAN BODY"), makeTemplate("review", "REVIEW: $ARGUMENTS")];

	test("front-anchored single command keeps full arg substitution (backward compatible)", () => {
		expect(expandPromptTemplate("/review the diff please", templates)).toBe("REVIEW: the diff please");
	});

	test("front-anchored single command with no args", () => {
		expect(expandPromptTemplate("/writing-plans", templates)).toBe("PLAN BODY");
	});

	test("recognized command NOT at the front is expanded in place (positional)", () => {
		expect(expandPromptTemplate("please run /writing-plans now", templates)).toBe("please run PLAN BODY now");
	});

	test("multiple recognized commands expand inline, prose preserved", () => {
		expect(expandPromptTemplate("do /writing-plans then /review and stop", templates)).toBe(
			"do PLAN BODY then REVIEW:  and stop",
		);
	});

	test("unregistered slash tokens are left untouched (file paths, urls, regex)", () => {
		const text = "look in /usr/bin and at http://x.com and run s/foo/bar/ on /unknown-cmd";
		expect(expandPromptTemplate(text, templates)).toBe(text);
	});

	test("slash mid-word (not a boundary) is not a command", () => {
		expect(expandPromptTemplate("path a/writing-plans/b", templates)).toBe("path a/writing-plans/b");
	});

	test("no templates / no match returns text unchanged", () => {
		expect(expandPromptTemplate("just a normal message", templates)).toBe("just a normal message");
		expect(expandPromptTemplate("/writing-plans", [])).toBe("/writing-plans");
	});
});
