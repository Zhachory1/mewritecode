/**
 * run-prompt-prose.test.ts — unit tests for the PURE pieces of the single-prompt
 * prose microbench: %output-reduction + delta, prompt-loading/inlining, the
 * markdown table, and the median aggregation. NO network, NO SDK, NO filesystem —
 * every helper under test takes plain values/strings as input.
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../honest-metrics.js";
import type { JudgeResult } from "../prose-judge.js";
import {
	type ConditionResult,
	type GatedPromptResult,
	type PromptProseResult,
	type PromptSpec,
	aggregateReduction,
	buildGatedPromptResult,
	buildInlinedQuestion,
	buildPromptResult,
	filterBySplit,
	gatedAggregate,
	genreCounts,
	isGenre,
	isSplit,
	lastAssistantText,
	outputReductionPct,
	outputVariance,
	parsePromptsJsonl,
	parseReferenceArg,
	parseSplitArg,
	renderMarkdownTable,
	selectJudgeReference,
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
	const spec: PromptSpec = { id: "p1", question: "explain", genre: "code-explain", split: "tune" };

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
		// genre/split default to code-explain/tune when omitted in an override.
		expect(specs).toEqual([
			{ id: "a", question: "what is this", genre: "code-explain", split: "tune" },
			{ id: "b", question: "summarize", genre: "code-explain", split: "tune" },
		]);
	});

	it("preserves a valid genre/split/note when present", () => {
		const specs = parsePromptsJsonl(
			'{"id":"x","question":"q","genre":"trade-off","split":"test","note":"ext truth"}',
		);
		expect(specs[0]).toEqual({ id: "x", question: "q", genre: "trade-off", split: "test", note: "ext truth" });
	});

	it("throws on an invalid genre or split", () => {
		expect(() => parsePromptsJsonl('{"id":"x","question":"q","genre":"poetry"}')).toThrow(/genre/);
		expect(() => parsePromptsJsonl('{"id":"x","question":"q","split":"holdout"}')).toThrow(/split/);
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

// ---------------------------------------------------------------------------
// A1 — split/genre guards + filtering
// ---------------------------------------------------------------------------

describe("isGenre / isSplit", () => {
	it("accepts the frozen members and rejects others", () => {
		expect(isGenre("code-explain")).toBe(true);
		expect(isGenre("risk-enumeration")).toBe(true);
		expect(isGenre("poetry")).toBe(false);
		expect(isSplit("tune")).toBe(true);
		expect(isSplit("validation")).toBe(true);
		expect(isSplit("test")).toBe(true);
		expect(isSplit("all")).toBe(false);
		expect(isSplit("holdout")).toBe(false);
	});
});

describe("parseSplitArg", () => {
	it("accepts tune|validation|test|all", () => {
		expect(parseSplitArg("tune")).toBe("tune");
		expect(parseSplitArg("validation")).toBe("validation");
		expect(parseSplitArg("test")).toBe("test");
		expect(parseSplitArg("all")).toBe("all");
	});
	it("throws on anything else", () => {
		expect(() => parseSplitArg("train")).toThrow(/tune\|validation\|test\|all/);
	});
});

describe("filterBySplit", () => {
	const corpus: PromptSpec[] = [
		{ id: "a", question: "q", genre: "code-explain", split: "tune" },
		{ id: "b", question: "q", genre: "trade-off", split: "validation" },
		{ id: "c", question: "q", genre: "short-factual", split: "test" },
		{ id: "d", question: "q", genre: "trade-off", split: "tune" },
	];
	it("keeps only the matching partition", () => {
		expect(filterBySplit(corpus, "tune").map((p) => p.id)).toEqual(["a", "d"]);
		expect(filterBySplit(corpus, "validation").map((p) => p.id)).toEqual(["b"]);
		expect(filterBySplit(corpus, "test").map((p) => p.id)).toEqual(["c"]);
	});
	it("'all' returns everything", () => {
		expect(filterBySplit(corpus, "all")).toHaveLength(4);
	});
});

describe("genreCounts", () => {
	it("counts prompts per genre across all five genres", () => {
		const corpus: PromptSpec[] = [
			{ id: "a", question: "q", genre: "code-explain", split: "tune" },
			{ id: "b", question: "q", genre: "code-explain", split: "tune" },
			{ id: "c", question: "q", genre: "trade-off", split: "tune" },
		];
		const counts = genreCounts(corpus);
		expect(counts["code-explain"]).toBe(2);
		expect(counts["trade-off"]).toBe(1);
		expect(counts["risk-enumeration"]).toBe(0);
		expect(counts["multi-step-trace"]).toBe(0);
		expect(counts["short-factual"]).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// A3 — outputVariance (stability gate)
// ---------------------------------------------------------------------------

describe("outputVariance", () => {
	it("computes mean/min/max and relSpread", () => {
		const v = outputVariance([100, 102, 98]);
		expect(v.mean).toBeCloseTo(100, 10);
		expect(v.min).toBe(98);
		expect(v.max).toBe(102);
		expect(v.relSpread).toBeCloseTo(0.04, 10); // (102-98)/100
		expect(v.flagged).toBe(false); // 4% <= 5%
	});

	it("FLAGS a prompt whose spread exceeds 5% of the mean", () => {
		const v = outputVariance([100, 110, 95]); // spread 15 / mean ~101.67 = ~14.8%
		expect(v.flagged).toBe(true);
		expect(v.relSpread).toBeGreaterThan(0.05);
	});

	it("does not flag the boundary (exactly 5%)", () => {
		const v = outputVariance([100, 105, 100]); // spread 5 / mean ~101.67 = ~4.9%
		expect(v.flagged).toBe(false);
	});

	it("empty input → all zero, not flagged (no data is not instability)", () => {
		expect(outputVariance([])).toEqual({ mean: 0, min: 0, max: 0, relSpread: 0, flagged: false });
	});

	it("all-zero outputs → relSpread 0, not flagged (no spread to normalize)", () => {
		const v = outputVariance([0, 0, 0]);
		expect(v.relSpread).toBe(0);
		expect(v.flagged).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// A4 — buildGatedPromptResult + gatedAggregate + headline validity
// ---------------------------------------------------------------------------

const judge = (recall: number, qualifierFidelity = 1, addedUnsupported = 0): JudgeResult => ({
	recall,
	qualifierFidelity,
	addedUnsupported,
	claims: [],
});

describe("buildGatedPromptResult", () => {
	it("PASSES when substance holds AND token count is stable", () => {
		const g = buildGatedPromptResult({
			id: "p",
			genre: "trade-off",
			split: "tune",
			reductionPct: 0.4,
			judge: judge(0.95),
			maxRelSpread: 0.02,
		});
		expect(g.pass).toBe(true);
		expect(g.unstable).toBe(false);
	});

	it("FAILS when the substance gate fails (low recall) even if stable", () => {
		const g = buildGatedPromptResult({
			id: "p",
			genre: "trade-off",
			split: "tune",
			reductionPct: 0.4,
			judge: judge(0.8),
			maxRelSpread: 0.01,
		});
		expect(g.pass).toBe(false);
	});

	it("FAILS an UNSTABLE prompt even if the substance gate would pass", () => {
		const g = buildGatedPromptResult({
			id: "p",
			genre: "trade-off",
			split: "tune",
			reductionPct: 0.4,
			judge: judge(0.99),
			maxRelSpread: 0.12, // > 5%
		});
		expect(g.unstable).toBe(true);
		expect(g.pass).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// --reference off|gold — flag parsing + which text the judge reference becomes
// ---------------------------------------------------------------------------

describe("parseReferenceArg", () => {
	it("accepts off|gold", () => {
		expect(parseReferenceArg("off")).toBe("off");
		expect(parseReferenceArg("gold")).toBe("gold");
	});
	it("throws on anything else", () => {
		expect(() => parseReferenceArg("baseline")).toThrow(/off\|gold/);
	});
});

describe("selectJudgeReference", () => {
	it("off mode → the judge reference is the OFF-mode answer (current behavior)", () => {
		expect(selectJudgeReference("off", "the off answer", "the gold")).toBe("the off answer");
		// gold may be absent in off mode and that's fine
		expect(selectJudgeReference("off", "the off answer", null)).toBe("the off answer");
	});

	it("gold mode → the judge reference becomes the GOLD answer", () => {
		expect(selectJudgeReference("gold", "the off answer", "the gold")).toBe("the gold");
	});

	it("gold mode with a missing gold throws (never silently grade against null)", () => {
		expect(() => selectJudgeReference("gold", "the off answer", null)).toThrow(/requires a gold/);
	});

	it("the REDUCTION metric is independent of reference mode (off-token denominator unchanged)", () => {
		// selectJudgeReference only changes the SUBSTANCE reference. The reduction is
		// computed from output-token counts via outputReductionPct and never reads the
		// reference text — so the SAME off/full token counts give the SAME reduction
		// regardless of which reference the judge would use.
		const offTokens = 100;
		const fullTokens = 40;
		const reduction = outputReductionPct(offTokens, fullTokens);
		expect(reduction).toBeCloseTo(0.6, 10);
		// switching the judge reference to gold does not touch these numbers
		expect(selectJudgeReference("gold", "off text", "gold text")).toBe("gold text");
		expect(outputReductionPct(offTokens, fullTokens)).toBe(reduction);
	});
});

describe("gatedAggregate", () => {
	const mk = (id: string, reductionPct: number | null, pass: boolean, unstable = false): GatedPromptResult => ({
		id,
		genre: "trade-off",
		split: "tune",
		reductionPct,
		recall: pass ? 0.95 : 0.5,
		qualifierFidelity: 1,
		addedUnsupported: 0,
		maxRelSpread: unstable ? 0.1 : 0.01,
		unstable,
		pass,
	});

	it("medians reduction over PASS prompts only", () => {
		const results = [mk("a", 0.5, true), mk("b", 0.3, true), mk("c", 0.1, false)];
		const agg = gatedAggregate(results);
		// PASS reductions: 0.5, 0.3 → median 0.4
		expect(agg.gatedMedianReduction).toBeCloseTo(0.4, 10);
		expect(agg.nPass).toBe(2);
		expect(agg.nTotal).toBe(3);
	});

	it("headlineValid true at >=80% PASS, false below", () => {
		const passing = Array.from({ length: 8 }, (_, i) => mk(`p${i}`, 0.4, true));
		const failing = [mk("f1", 0.1, false), mk("f2", 0.1, false)];
		// 8/10 = 80% → valid
		expect(gatedAggregate([...passing, ...failing]).headlineValid).toBe(true);
		// 7/10 = 70% → invalid
		expect(gatedAggregate([...passing.slice(0, 7), mk("f3", 0.1, false), ...failing]).headlineValid).toBe(false);
	});

	it("counts a PASS toward nPass even if its reduction is null, but keeps it out of the median", () => {
		// pass=true with null reduction can't happen via passes() (the gate requires
		// reductionPct>0), but if a result is constructed that way directly, nPass must
		// still count the PASS verdict (n_pass/n_total integrity) while the null stays
		// out of the median accumulator.
		const results = [mk("a", 0.5, true), mk("weird", null, true)];
		const agg = gatedAggregate(results);
		expect(agg.gatedMedianReduction).toBeCloseTo(0.5, 10); // null excluded from median
		expect(agg.nPass).toBe(2); // both PASS verdicts counted
		expect(agg.passRatio).toBeCloseTo(1, 10);
	});

	it("empty input → zero median, headline INVALID (no claim from nothing)", () => {
		const agg = gatedAggregate([]);
		expect(agg.gatedMedianReduction).toBe(0);
		expect(agg.nPass).toBe(0);
		expect(agg.nTotal).toBe(0);
		expect(agg.headlineValid).toBe(false);
	});
});
