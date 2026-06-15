/**
 * run-prompt-prose.test.ts — unit tests for the PURE pieces of the single-prompt
 * prose microbench: %output-reduction + delta, prompt-loading/inlining, the
 * markdown table, and the median aggregation. NO network, NO SDK, NO filesystem —
 * every helper under test takes plain values/strings as input.
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../honest-metrics.js";
import {
	type ConditionResult,
	type PromptProseResult,
	type PromptSpec,
	aggregateReduction,
	buildInlinedQuestion,
	buildPromptResult,
	lastAssistantText,
	outputReductionPct,
	parsePromptsJsonl,
	renderMarkdownTable,
	truncateForInline,
} from "../run-prompt-prose.js";

const usage = (output: number, input = 100): Usage => ({ input, output, cacheRead: 0, cacheWrite: 0 });
const cond = (output: number, input = 100, responseText = "x"): ConditionResult => ({
	usage: usage(output, input),
	responseText,
});

// ---------------------------------------------------------------------------
// outputReductionPct
// ---------------------------------------------------------------------------

describe("outputReductionPct", () => {
	it("computes (off - full) / off for a normal reduction", () => {
		expect(outputReductionPct(100, 40)).toBeCloseTo(0.6, 10);
	});

	it("returns null on a zero-output baseline (undefined ratio, never divide by zero)", () => {
		expect(outputReductionPct(0, 0)).toBeNull();
		expect(outputReductionPct(0, 10)).toBeNull();
	});

	it("returns a NEGATIVE reduction (honestly) when prose made the output LONGER", () => {
		expect(outputReductionPct(100, 150)).toBeCloseTo(-0.5, 10);
	});

	it("is 0 when off and full match exactly", () => {
		expect(outputReductionPct(80, 80)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// buildPromptResult
// ---------------------------------------------------------------------------

describe("buildPromptResult", () => {
	const spec: PromptSpec = { id: "p1", question: "explain" };

	it("captures output delta, %reduction, and input delta", () => {
		const r = buildPromptResult(spec, cond(100, 200), cond(60, 250));
		expect(r.id).toBe("p1");
		expect(r.outputDelta).toBe(40); // 100 - 60
		expect(r.reductionPct).toBeCloseTo(0.4, 10);
		// input delta negative: the cave block ADDS input tokens (200 - 250)
		expect(r.inputDelta).toBe(-50);
	});

	it("propagates a null reduction when the off baseline produced 0 output", () => {
		const r = buildPromptResult(spec, cond(0), cond(0));
		expect(r.reductionPct).toBeNull();
		expect(r.outputDelta).toBe(0);
	});

	it("keeps both response texts for eyeballing", () => {
		const r = buildPromptResult(spec, cond(10, 100, "long off answer"), cond(4, 100, "ug short"));
		expect(r.off.responseText).toBe("long off answer");
		expect(r.full.responseText).toBe("ug short");
	});
});

// ---------------------------------------------------------------------------
// aggregateReduction
// ---------------------------------------------------------------------------

describe("aggregateReduction", () => {
	const mk = (id: string, off: number, full: number): PromptProseResult =>
		buildPromptResult({ id, question: "q" }, cond(off), cond(full));

	it("medians the %reductions across prompts (reuses meanSdMedian)", () => {
		const results = [mk("a", 100, 50), mk("b", 100, 60), mk("c", 100, 80)];
		// reductions: 0.5, 0.4, 0.2 → median 0.4
		const agg = aggregateReduction(results);
		expect(agg.median).toBeCloseTo(0.4, 10);
		expect(agg.mean).toBeCloseTo((0.5 + 0.4 + 0.2) / 3, 10);
		expect(agg.n).toBe(3);
		expect(agg.nExcluded).toBe(0);
	});

	it("EXCLUDES zero-baseline prompts from the median (not counted as 0)", () => {
		const results = [mk("a", 100, 50), mk("zero", 0, 0), mk("b", 100, 60)];
		const agg = aggregateReduction(results);
		// only 0.5 and 0.4 contribute → median 0.45, n=2, one excluded
		expect(agg.median).toBeCloseTo(0.45, 10);
		expect(agg.n).toBe(2);
		expect(agg.nExcluded).toBe(1);
	});

	it("empty input → all-zero stats, nothing excluded", () => {
		const agg = aggregateReduction([]);
		expect(agg).toEqual({ median: 0, mean: 0, sd: 0, n: 0, nExcluded: 0 });
	});
});

// ---------------------------------------------------------------------------
// parsePromptsJsonl
// ---------------------------------------------------------------------------

describe("parsePromptsJsonl", () => {
	it("parses one {id, question} per line, skipping blank lines", () => {
		const jsonl = [
			'{"id":"a","question":"what is this"}',
			"",
			'{"id":"b","question":"summarize"}',
			"   ",
		].join("\n");
		const specs = parsePromptsJsonl(jsonl);
		expect(specs).toEqual([
			{ id: "a", question: "what is this" },
			{ id: "b", question: "summarize" },
		]);
	});

	it("throws with the 1-based line number on invalid JSON", () => {
		expect(() => parsePromptsJsonl('{"id":"a","question":"ok"}\nNOT JSON')).toThrow(/line 2/);
	});

	it("throws on a missing/empty id", () => {
		expect(() => parsePromptsJsonl('{"question":"q"}')).toThrow(/line 1.*id/);
		expect(() => parsePromptsJsonl('{"id":"  ","question":"q"}')).toThrow(/id/);
	});

	it("throws on a missing/empty question", () => {
		expect(() => parsePromptsJsonl('{"id":"a"}')).toThrow(/question/);
		expect(() => parsePromptsJsonl('{"id":"a","question":""}')).toThrow(/question/);
	});

	it("throws on a non-object line", () => {
		expect(() => parsePromptsJsonl("42")).toThrow(/object/);
	});

	it("empty contents → empty list (no throw)", () => {
		expect(parsePromptsJsonl("")).toEqual([]);
		expect(parsePromptsJsonl("\n\n  \n")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// truncateForInline
// ---------------------------------------------------------------------------

describe("truncateForInline", () => {
	it("returns the text unchanged when within budget", () => {
		expect(truncateForInline("short", 100)).toBe("short");
	});

	it("truncates oversized text and appends a marker", () => {
		const text = "line1\nline2\nline3\nline4\nline5\n";
		const out = truncateForInline(text, 12);
		expect(out).toContain("truncated for benchmark");
		// body itself (before the marker) is <= maxChars of original content
		const body = out.split("\n... [truncated")[0];
		expect(body.length).toBeLessThanOrEqual(12);
	});

	it("cuts on a whole line boundary when possible", () => {
		const text = "alpha\nbeta\ngamma\ndelta";
		const out = truncateForInline(text, 9); // "alpha\nbet" → last \n at idx 5
		const body = out.split("\n... [truncated")[0];
		expect(body).toBe("alpha");
	});

	it("reports the number of dropped chars in the marker", () => {
		const text = "a".repeat(100);
		const out = truncateForInline(text, 10);
		// no newline → body is the 10-char head, 90 dropped
		expect(out).toContain("90 more chars");
	});
});

// ---------------------------------------------------------------------------
// buildInlinedQuestion
// ---------------------------------------------------------------------------

describe("buildInlinedQuestion", () => {
	it("wraps the inlined contents in a fenced block and asks for an explanation", () => {
		const q = buildInlinedQuestion("the foo module", "ts", "export const x = 1;");
		expect(q).toContain("the foo module");
		expect(q).toContain("Explain what it does");
		expect(q).toContain("```ts");
		expect(q).toContain("export const x = 1;");
		expect(q.trimEnd().endsWith("```")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// renderMarkdownTable
// ---------------------------------------------------------------------------

describe("renderMarkdownTable", () => {
	const mk = (id: string, off: number, full: number): PromptProseResult =>
		buildPromptResult({ id, question: "q" }, cond(off), cond(full));

	it("renders a header + one row per prompt with Δ%", () => {
		const md = renderMarkdownTable([mk("a", 100, 40)]);
		const lines = md.split("\n");
		expect(lines[0]).toContain("prompt");
		expect(lines[0]).toContain("Δ%");
		// data row: out_off=100, out_full=40, Δout=60, Δ%=60.0%
		expect(lines[2]).toContain("| a |");
		expect(lines[2]).toContain("| 100 |");
		expect(lines[2]).toContain("| 40 |");
		expect(lines[2]).toContain("60.0%");
	});

	it("renders n/a for a zero-baseline reduction", () => {
		const md = renderMarkdownTable([mk("zero", 0, 0)]);
		expect(md).toContain("n/a");
	});
});

// ---------------------------------------------------------------------------
// lastAssistantText
// ---------------------------------------------------------------------------

describe("lastAssistantText", () => {
	it("concatenates text blocks of the LAST assistant message", () => {
		const messages = [
			{ role: "user", content: [{ type: "text", text: "q" }] },
			{ role: "assistant", content: [{ type: "text", text: "old" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "ug " },
					{ type: "text", text: "fire good" },
				],
			},
		];
		expect(lastAssistantText(messages)).toBe("ug fire good");
	});

	it("ignores non-text content (thinking / tool calls)", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "hmm" },
					{ type: "text", text: "answer" },
					{ type: "toolCall", id: "1" },
				],
			},
		];
		expect(lastAssistantText(messages)).toBe("answer");
	});

	it("returns empty string when there is no assistant message", () => {
		expect(lastAssistantText([{ role: "user", content: [{ type: "text", text: "q" }] }])).toBe("");
		expect(lastAssistantText([])).toBe("");
	});

	it("returns empty string when the assistant content is not an array", () => {
		expect(lastAssistantText([{ role: "assistant", content: "raw" }])).toBe("");
	});
});
