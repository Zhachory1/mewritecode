#!/usr/bin/env npx tsx
/**
 * run-prompt-prose.ts — single-prompt PROSE microbench for Cave CLI.
 *
 * GOAL: isolate, as cleanly as possible, how much caveman PROSE shrinks a model's
 * RESPONSE on ONE question→answer turn — no tools, no agent loop, no SWE-bench, no
 * Docker. For each (prompt × prose∈{off,full}) we spin up a FRESH single-turn
 * session (`tools: []`, `maxTurns: 1`), ask the same question, and compare OUTPUT
 * tokens. prose-off = caveman fully disabled for the session; prose-full = caveman
 * enabled at "full" intensity (mirrors run-swebench's --cave wiring). The metric is
 * %output-reduction = (out_off − out_full) / out_off.
 *
 * ── HONESTY NOTE (read before quoting any number) ───────────────────────────────
 * This measures OUTPUT-prose compression on SINGLE turns ONLY. It is a CLEAN but
 * PARTIAL view of caveman's effect: it captures how terse-prose styling shrinks the
 * model's generated answer, and nothing else. Real-usage savings ALSO come from
 *   (a) INPUT / tool-output compression (the separate compression knob, #33), and
 *   (b) prompt-cache reuse amortized over LONG multi-turn sessions (#36).
 * Neither of those is exercised here (no tools, one turn, no cache warm-up). Do NOT
 * present this %output-reduction as a total-cost saving — it is the output-prose
 * slice in isolation. See research/results/* and #36 for the full picture.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Cheap by construction: a cheap default model (gpt-4o-mini), one turn each, a
 * handful of prompts × 2 conditions = pennies. The operator runs the PAID part;
 * `--dry-run` makes NO network/SDK calls (prints the plan + prompt ids only).
 *
 * The %reduction / aggregation / prompt-loading+inlining logic is factored into
 * PURE exported helpers (no I/O, no SDK) so research/evals/__tests__ can cover them
 * without touching the network.
 *
 * Usage:
 *   npx tsx research/evals/run-prompt-prose.ts [options]
 *
 * Options:
 *   --model <pattern>   Model id (default: gpt-4o-mini — cheap)
 *   --provider <name>   LLM provider (default: openai)
 *   --limit <n>         Max prompts to run (default: all)
 *   --output <dir>      Output dir (default: research/results/prose-<date>/)
 *   --prompts <jsonl>   Override built-in prompt set; each line {id, question}
 *   --dry-run           Print the plan + prompt ids, NO network/SDK calls
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "../../packages/agent/src/index.js";
import { getModel } from "../../packages/ai/src/models.js";
import { createAgentSession } from "../../packages/coding-agent/src/core/sdk.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { SettingsManager } from "../../packages/coding-agent/src/core/settings-manager.js";
import { type Usage, meanSdMedian } from "./honest-metrics.js";
import {
	GOLD_MODEL,
	GOLD_PROMPT_VERSION,
	GOLD_PROVIDER,
	type GoldSpec,
	type GoldStore,
	type GoldValidation,
	type ResolvedGold,
	buildGoldValidation,
	loadOrGenerateGold,
	summarizeGoldValidation,
} from "./prose-gold.js";
import {
	JUDGE_MODEL,
	JUDGE_PROVIDER,
	type JudgeResult,
	type JudgeVersion,
	type RunOneShot,
	judgeSubstance,
	parseJudgeVersionArg,
	passes,
	selectJudgeSystem,
} from "./prose-judge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two prose conditions this microbench contrasts. `ultra` is the ceiling probe. */
export type ProseCondition = "off" | "full" | "ultra";

/**
 * Which text the SUBSTANCE judge uses as its REFERENCE.
 *  - "off"  (default, current behavior): grade recall/qualifier/added vs the verbose
 *           OFF-mode answer.
 *  - "gold": grade recall/qualifier/added vs a frozen, complete-but-terse GOLD answer
 *           — removes the bias where caveman dropping FILLER (present only in the
 *           padded off answer) is miscounted as dropped FACTS.
 *
 * CRITICAL INVARIANT (anti-gaming): the REDUCTION metric is UNAFFECTED by this flag.
 * Reduction is ALWAYS (out_off − out_full)/out_off — measured against the REAL verbose
 * baseline. The gold is used ONLY as the substance-judge reference, NEVER as the
 * reduction denominator. See selectJudgeReference + the main loop.
 */
export type ReferenceMode = "off" | "gold";

/**
 * Pick the text the substance judge grades against. PURE. In "off" mode the reference
 * is the off-mode answer (current behavior). In "gold" mode it is the frozen gold.
 * This is the ONLY thing the reference flag changes — the reduction denominator stays
 * the off-mode output-token count regardless (enforced at the call site, not here).
 */
export function selectJudgeReference(mode: ReferenceMode, offText: string, goldText: string | null): string {
	if (mode === "gold") {
		if (goldText === null) {
			throw new Error("selectJudgeReference: reference mode 'gold' requires a gold text, got null");
		}
		return goldText;
	}
	return offText;
}

/** Task genres the corpus must span (DD §0.1: ≥3 per genre across partitions). */
export type Genre = "code-explain" | "trade-off" | "risk-enumeration" | "multi-step-trace" | "short-factual";

/** The three locked partitions (DD §0.1). `test` is evaluated ONCE on the 2nd model. */
export type Split = "tune" | "validation" | "test";

/** One prompt: a stable id, the natural-language question, its genre + partition. */
export interface PromptSpec {
	id: string;
	question: string;
	genre: Genre;
	split: Split;
	/** Optional note, e.g. EXTERNAL ground-truth provenance for a test prompt. */
	note?: string;
}

/** Per-condition capture for one prompt: usage + the assistant response text. */
export interface ConditionResult {
	usage: Usage;
	responseText: string;
}

/**
 * Per-prompt comparison record. `reductionPct` is the OUTPUT-token reduction
 * (off→full); null when off produced 0 output tokens (undefined ratio — never
 * fabricate a reduction from a zero denominator).
 */
export interface PromptProseResult {
	id: string;
	question: string;
	off: ConditionResult;
	full: ConditionResult;
	/** out_off − out_full (output tokens saved by prose). Can be negative if full was longer. */
	outputDelta: number;
	/** (out_off − out_full) / out_off, in [−∞, 1]. null when out_off === 0. */
	reductionPct: number | null;
	/** input_off − input_full (negative: the cave block ADDS input tokens). Diagnostic. */
	inputDelta: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O, no SDK) — unit-tested in __tests__
// ---------------------------------------------------------------------------

/**
 * OUTPUT-token reduction for one prompt: (out_off − out_full) / out_off.
 * PURE. Returns null when `outputOff` is 0 (undefined ratio — do not divide by
 * zero or invent a reduction). A negative result means prose-full produced MORE
 * output than prose-off (prose made it longer) — reported honestly, not clamped.
 */
export function outputReductionPct(outputOff: number, outputFull: number): number | null {
	if (outputOff === 0) return null;
	return (outputOff - outputFull) / outputOff;
}

/**
 * Build the per-prompt comparison record from the two captured conditions.
 * PURE. Computes the output delta, %reduction (null-safe), and input delta.
 */
export function buildPromptResult(spec: PromptSpec, off: ConditionResult, full: ConditionResult): PromptProseResult {
	return {
		id: spec.id,
		question: spec.question,
		off,
		full,
		outputDelta: off.usage.output - full.usage.output,
		reductionPct: outputReductionPct(off.usage.output, full.usage.output),
		inputDelta: off.usage.input - full.usage.input,
	};
}

/**
 * Aggregate the median %output-reduction across prompts (reuses meanSdMedian).
 * PURE. Only prompts with a DEFINED reduction (out_off > 0) contribute — a null
 * reduction (zero-output baseline) is excluded rather than counted as 0, so the
 * median isn't dragged toward zero by undefined cases. Returns the meanSdMedian
 * stats over the contributing fractions plus `nExcluded` for transparency.
 */
export function aggregateReduction(results: PromptProseResult[]): {
	median: number;
	mean: number;
	sd: number;
	n: number;
	nExcluded: number;
} {
	const fractions: number[] = [];
	let nExcluded = 0;
	for (const r of results) {
		if (r.reductionPct === null) nExcluded += 1;
		else fractions.push(r.reductionPct);
	}
	const stats = meanSdMedian(fractions);
	return { ...stats, nExcluded };
}

// ---------------------------------------------------------------------------
// A3 — stability: per-(prompt,condition) repeats at temp 0.
// ---------------------------------------------------------------------------

/** Frozen stability threshold: a prompt with (max−min)/mean > this is flagged + excluded. */
export const VARIANCE_THRESHOLD = 0.05 as const;
/** Settle delay (ms) after createAgentSession before prompting — lets the async runtime build finish (mirrors run-swebench). */
const SESSION_SETTLE_MS = 100;

/** Variance summary over the per-repeat output-token counts of one condition. */
export interface VarianceStat {
	mean: number;
	min: number;
	max: number;
	/** (max − min) / mean. 0 when mean is 0 (no spread to normalize). */
	relSpread: number;
	/** relSpread > VARIANCE_THRESHOLD → unstable token count, exclude the prompt. */
	flagged: boolean;
}

/**
 * Compute the output-token variance summary over n repeats of ONE condition. PURE.
 * `relSpread = (max − min) / mean`; a prompt whose relSpread exceeds
 * VARIANCE_THRESHOLD (5%) is `flagged` so the aggregate can EXCLUDE it rather than
 * average over an unstable token count. Empty input → all-zero, not flagged (no
 * data is not instability). A zero mean (all-zero outputs) → relSpread 0, not
 * flagged (no spread to normalize, and the gate excludes it elsewhere).
 */
export function outputVariance(perRepeatOutput: number[]): VarianceStat {
	if (perRepeatOutput.length === 0) {
		return { mean: 0, min: 0, max: 0, relSpread: 0, flagged: false };
	}
	const mean = perRepeatOutput.reduce((a, b) => a + b, 0) / perRepeatOutput.length;
	const min = Math.min(...perRepeatOutput);
	const max = Math.max(...perRepeatOutput);
	const relSpread = mean === 0 ? 0 : (max - min) / mean;
	return { mean, min, max, relSpread, flagged: relSpread > VARIANCE_THRESHOLD };
}

// ---------------------------------------------------------------------------
// A4 — gated per-prompt aggregate + headline validity.
// ---------------------------------------------------------------------------

/**
 * Per-prompt gated record: mean reductionPct over repeats, the judge dimensions,
 * the stability flag, and the PASS verdict. This is what the table + the gated
 * aggregate are built from.
 */
export interface GatedPromptResult {
	id: string;
	genre: Genre;
	split: Split;
	/** mean output-token reduction over repeats (null if off baseline had 0 output). */
	reductionPct: number | null;
	recall: number;
	qualifierFidelity: number;
	addedUnsupported: number;
	/** max relSpread across the off + full repeat sets (worst-case stability). */
	maxRelSpread: number;
	/** any condition's token count was unstable (relSpread > 5%). */
	unstable: boolean;
	/** PASS per DD §0.1 gate AND stable (an unstable prompt cannot count as a win). */
	pass: boolean;
}

/** Frozen headline-validity threshold (DD §0.1): need ≥80% of prompts to PASS. */
export const HEADLINE_PASS_RATIO = 0.8 as const;

/**
 * Build a per-prompt gated record. PURE. `pass` requires BOTH the substance gate
 * (`passes(...)`) AND stability (not `unstable`): an unstable token count cannot be
 * trusted as a win even if the substance held.
 */
export function buildGatedPromptResult(args: {
	id: string;
	genre: Genre;
	split: Split;
	reductionPct: number | null;
	judge: JudgeResult;
	maxRelSpread: number;
}): GatedPromptResult {
	const unstable = args.maxRelSpread > VARIANCE_THRESHOLD;
	const gated = passes({
		reductionPct: args.reductionPct,
		recall: args.judge.recall,
		qualifierFidelity: args.judge.qualifierFidelity,
		addedUnsupported: args.judge.addedUnsupported,
	});
	return {
		id: args.id,
		genre: args.genre,
		split: args.split,
		reductionPct: args.reductionPct,
		recall: args.judge.recall,
		qualifierFidelity: args.judge.qualifierFidelity,
		addedUnsupported: args.judge.addedUnsupported,
		maxRelSpread: args.maxRelSpread,
		unstable,
		pass: gated && !unstable,
	};
}

/**
 * Gated aggregate over per-prompt records (DD §0.1). PURE.
 *  - `gatedMedianReduction` = MEDIAN reductionPct over PASS prompts ONLY (a fail —
 *    incl. a longer answer or an unstable count — contributes nothing).
 *  - `nPass` / `nTotal` reported always.
 *  - `headlineValid` = nPass/nTotal >= 0.80. A median computed over <80% passing
 *    prompts is NOT a publishable headline (it would be cherry-picked).
 * Empty input → median 0, nPass 0, nTotal 0, headlineValid false (no claim from nothing).
 */
export function gatedAggregate(results: GatedPromptResult[]): {
	gatedMedianReduction: number;
	gatedMeanReduction: number;
	nPass: number;
	nTotal: number;
	passRatio: number;
	headlineValid: boolean;
} {
	// nPass is the count of PASS verdicts — independent of the median accumulator,
	// so a (gate-impossible but defensively handled) PASS with a null reductionPct
	// still counts toward n_pass/n_total rather than silently deflating passRatio.
	const passReductions: number[] = [];
	for (const r of results) {
		if (r.pass && r.reductionPct !== null) passReductions.push(r.reductionPct);
	}
	const stats = meanSdMedian(passReductions);
	const nTotal = results.length;
	const nPass = results.filter((r) => r.pass).length;
	const passRatio = nTotal === 0 ? 0 : nPass / nTotal;
	return {
		gatedMedianReduction: stats.median,
		gatedMeanReduction: stats.mean,
		nPass,
		nTotal,
		passRatio,
		headlineValid: nTotal > 0 && passRatio >= HEADLINE_PASS_RATIO,
	};
}

/**
 * Parse a `--prompts` JSONL override into PromptSpec[]. PURE (takes file CONTENTS,
 * not a path). Blank lines are skipped. Each non-blank line must be a JSON object
 * with non-empty string `id` and `question`; anything else throws with the 1-based
 * line number so a malformed override fails loudly rather than silently dropping
 * prompts.
 */
export function parsePromptsJsonl(contents: string): PromptSpec[] {
	const out: PromptSpec[] = [];
	const lines = contents.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`--prompts line ${i + 1}: not valid JSON`);
		}
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error(`--prompts line ${i + 1}: expected a JSON object {id, question}`);
		}
		const obj = parsed as Record<string, unknown>;
		if (typeof obj.id !== "string" || obj.id.trim() === "") {
			throw new Error(`--prompts line ${i + 1}: missing/empty string "id"`);
		}
		if (typeof obj.question !== "string" || obj.question.trim() === "") {
			throw new Error(`--prompts line ${i + 1}: missing/empty string "question"`);
		}
		// genre/split are OPTIONAL in an override (default to code-explain/tune); when
		// present they must be valid members of the frozen enums.
		const genre = obj.genre === undefined ? "code-explain" : obj.genre;
		if (!isGenre(genre)) {
			throw new Error(`--prompts line ${i + 1}: invalid "genre" (got ${JSON.stringify(obj.genre)})`);
		}
		const split = obj.split === undefined ? "tune" : obj.split;
		if (!isSplit(split)) {
			throw new Error(`--prompts line ${i + 1}: invalid "split" (got ${JSON.stringify(obj.split)})`);
		}
		const spec: PromptSpec = { id: obj.id, question: obj.question, genre, split };
		if (typeof obj.note === "string") spec.note = obj.note;
		out.push(spec);
	}
	return out;
}

const GENRES: readonly Genre[] = ["code-explain", "trade-off", "risk-enumeration", "multi-step-trace", "short-factual"];
const SPLITS: readonly Split[] = ["tune", "validation", "test"];

/** PURE type guards for the frozen enums. */
export function isGenre(x: unknown): x is Genre {
	return typeof x === "string" && (GENRES as readonly string[]).includes(x);
}
export function isSplit(x: unknown): x is Split {
	return typeof x === "string" && (SPLITS as readonly string[]).includes(x);
}

/**
 * Filter a corpus by the `--split` selector. PURE. "all" returns everything;
 * otherwise keep prompts whose `split` matches. Exported for unit testing the
 * partition logic without touching the filesystem.
 */
export function filterBySplit(prompts: PromptSpec[], selector: Split | "all"): PromptSpec[] {
	if (selector === "all") return prompts;
	return prompts.filter((p) => p.split === selector);
}

/**
 * Truncate `text` to at most `maxChars`, appending a clear marker when cut, so an
 * inlined source file stays English-readable-sized and the prompt cost stays low.
 * PURE. Cuts on a whole line where possible (avoids slicing mid-line) and never
 * returns more than `maxChars` of original content.
 */
export function truncateForInline(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = text.slice(0, maxChars);
	const lastNl = head.lastIndexOf("\n");
	const body = lastNl > 0 ? head.slice(0, lastNl) : head;
	return `${body}\n... [truncated for benchmark — ${text.length - body.length} more chars]`;
}

/**
 * Compose a grounded "explain this source" question that INLINES a file's contents
 * (already truncated by the caller). PURE — the file is read by the caller; this
 * just formats the prompt so the model produces grounded PROSE we can measure.
 */
export function buildInlinedQuestion(label: string, language: string, contents: string): string {
	return [
		`Below is ${label} from a TypeScript codebase. Explain what it does and summarize its design.`,
		"",
		`\`\`\`${language}`,
		contents,
		"```",
	].join("\n");
}

/**
 * Render the per-prompt markdown table: prompt | out_off | out_full | Δ% .
 * PURE. Δ% is shown to one decimal place; a null reduction (zero-output baseline)
 * renders as "n/a" rather than a fabricated number.
 */
export function renderMarkdownTable(results: PromptProseResult[]): string {
	const rows = [
		"| prompt | out_off | out_full | Δ out | Δ% |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const r of results) {
		const pct = r.reductionPct === null ? "n/a" : `${(r.reductionPct * 100).toFixed(1)}%`;
		rows.push(`| ${r.id} | ${r.off.usage.output} | ${r.full.usage.output} | ${r.outputDelta} | ${pct} |`);
	}
	return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Built-in CORPUS — diverse genres × locked partitions (DD §0.1).
//
// Genres: code-explain | trade-off | risk-enumeration | multi-step-trace |
// short-factual. ≥3 prompts per genre across the partitions. code-explain prompts
// INLINE real cavecode source (read at runtime, truncated); the other genres are
// natural questions about THIS codebase / general engineering. Each prompt is
// tagged with its locked split. Override with --prompts <jsonl>.
//
// The `test` partition is LOCKED: it is committed here and evaluated EXACTLY ONCE
// at the end of Phase B on the 2nd model. At least one test prompt carries an
// EXTERNAL ground-truth answer (noted) so the judge is not graded only against
// verbose off-mode output.
// ---------------------------------------------------------------------------

/** A code-explain prompt that inlines a real repo file. */
interface InlineSource {
	id: string;
	split: Split;
	label: string;
	language: string;
	/** Path relative to repo root. */
	relPath: string;
	/** Max chars of file contents to inline. */
	maxChars: number;
}

/** code-explain genre: grounded "explain this source" questions over real files. */
const CODE_EXPLAIN_SOURCES: InlineSource[] = [
	{
		id: "code-explain-roles",
		split: "tune",
		label: "the role-tagging module `packages/agent/src/roles.ts`",
		language: "ts",
		relPath: "packages/agent/src/roles.ts",
		maxChars: 2000,
	},
	{
		id: "code-explain-honest-metrics",
		split: "tune",
		label: "the header + token/pricing section of `research/evals/honest-metrics.ts`",
		language: "ts",
		relPath: "research/evals/honest-metrics.ts",
		maxChars: 2600,
	},
	{
		id: "code-explain-ai-types",
		split: "validation",
		label: "the message-type definitions from `packages/ai/src/types.ts`",
		language: "ts",
		relPath: "packages/ai/src/types.ts",
		maxChars: 2400,
	},
	{
		id: "code-explain-plan-cmd",
		split: "test",
		label: "the `/plan` slash command in `packages/coding-agent/src/core/slash-commands/plan.ts`",
		language: "ts",
		relPath: "packages/coding-agent/src/core/slash-commands/plan.ts",
		maxChars: 2200,
	},
];

/** Non-code genres: natural questions, no inlined file. */
interface NaturalPrompt {
	id: string;
	genre: Exclude<Genre, "code-explain">;
	split: Split;
	question: string;
	note?: string;
}

const NATURAL_PROMPTS: NaturalPrompt[] = [
	// ── trade-off ────────────────────────────────────────────────────────────
	{
		id: "tradeoff-median-vs-mean",
		genre: "trade-off",
		split: "tune",
		question:
			"In a cost-per-task benchmark, when should you report the MEDIAN cost vs the MEAN cost? " +
			"Explain the trade-off and when each is the right headline.",
	},
	{
		id: "tradeoff-temp0-vs-repeats",
		genre: "trade-off",
		split: "tune",
		question:
			"For stable token-count measurements, compare setting temperature=0 versus averaging over N>1 repeats. " +
			"When does each help, and when do you need both?",
	},
	{
		id: "tradeoff-monorepo-vs-polyrepo",
		genre: "trade-off",
		split: "validation",
		question:
			"Monorepo vs multiple separate repos for a TypeScript CLI with several published packages: " +
			"what are the trade-offs, and when does each win?",
	},
	// ── risk-enumeration ──────────────────────────────────────────────────────
	{
		id: "risk-cave-always-on",
		genre: "risk-enumeration",
		split: "tune",
		question:
			"What are the risks of running cave-mode (terse-prose styling) always-on in production for a coding agent? " +
			"Enumerate the failure modes and who they hurt.",
	},
	{
		id: "risk-no-permissions",
		genre: "risk-enumeration",
		split: "validation",
		question:
			"This coding agent runs with NO permission system (autopilot: it can edit files and run shell commands " +
			"without approval). Enumerate the risks of that design and the mitigations that matter most.",
	},
	{
		id: "risk-divide-by-zero-metric",
		genre: "risk-enumeration",
		split: "test",
		question:
			"A benchmark computes percent-reduction as (off - full) / off. Enumerate the ways this metric can mislead " +
			"or break (edge cases, gaming, division issues) and how to guard each.",
	},
	// ── multi-step-trace ──────────────────────────────────────────────────────
	{
		id: "trace-reduction-null-baseline",
		genre: "multi-step-trace",
		split: "tune",
		question:
			"Trace step by step what happens in outputReductionPct(outputOff, outputFull) when outputOff is 0: " +
			"what does it return, why, and what would callers (the aggregate, the table) do with that value?",
	},
	{
		id: "trace-gated-aggregate",
		genre: "multi-step-trace",
		split: "validation",
		question:
			"Trace how a single prompt flows from a raw judge result to the gated-median headline: " +
			"the per-prompt PASS decision, inclusion in the median, and the n_pass/n_total headline-validity check. " +
			"What happens at each step if the prompt FAILS the recall floor?",
	},
	{
		id: "trace-bootstrap-ci",
		genre: "multi-step-trace",
		split: "test",
		question:
			"Trace what a percentile bootstrap of the median does, step by step: resampling with replacement, " +
			"recomputing the statistic per iteration, sorting, and reading the 2.5/97.5 percentiles. " +
			"What goes wrong at very small n?",
	},
	// ── short-factual ─────────────────────────────────────────────────────────
	{
		id: "factual-temp0-meaning",
		genre: "short-factual",
		split: "tune",
		question: "What does setting an LLM sampling temperature to 0 do to its output? Answer concisely.",
		note: "EXTERNAL ground truth: temp=0 ⇒ greedy/argmax decoding ⇒ (near-)deterministic, lowest-variance output.",
	},
	{
		id: "factual-median-def",
		genre: "short-factual",
		split: "validation",
		question: "What is the median of a list of numbers, and how is it computed for an even-length list?",
		note: "EXTERNAL ground truth: middle value of the sorted list; even length ⇒ mean of the two central values.",
	},
	{
		id: "factual-recall-def",
		genre: "short-factual",
		split: "test",
		question:
			"In information retrieval, what does 'recall' mean? Give the definition and the formula. Answer concisely.",
		note: "EXTERNAL ground truth: recall = true positives / (true positives + false negatives) = fraction of relevant items retrieved.",
	},
];

/**
 * Load + assemble the built-in corpus from the repo. NOT pure (reads files for the
 * code-explain genre) — kept thin: it reads each source, calls the PURE
 * truncateForInline + buildInlinedQuestion, and returns specs with genre/split
 * tags. Failures to read a file are fatal (a microbench on missing source would be
 * silently meaningless). The natural-genre prompts need no I/O.
 */
function loadBuiltinPrompts(repoRoot: string): PromptSpec[] {
	const out: PromptSpec[] = [];
	for (const src of CODE_EXPLAIN_SOURCES) {
		const raw = readFileSync(join(repoRoot, src.relPath), "utf8");
		const inlined = truncateForInline(raw, src.maxChars);
		out.push({
			id: src.id,
			genre: "code-explain",
			split: src.split,
			question: buildInlinedQuestion(src.label, src.language, inlined),
		});
	}
	for (const p of NATURAL_PROMPTS) {
		const spec: PromptSpec = { id: p.id, genre: p.genre, split: p.split, question: p.question };
		if (p.note) spec.note = p.note;
		out.push(spec);
	}
	return out;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface RunConfig {
	model: string;
	provider: string;
	limit?: number;
	outputDir?: string;
	promptsPath?: string;
	dryRun: boolean;
	/** Partition selector (default tune). */
	split: Split | "all";
	/** Repeats per (prompt, condition) at temp 0 (default 3, min 1). */
	repeats: number;
	/** Judge model; defaults to the frozen JUDGE_MODEL and MUST differ from --model. */
	judgeModel: string;
	judgeProvider: string;
	/** Judge rubric version (default v1). v2 = semantic matching. Recorded in results.json. */
	judgeVersion: JudgeVersion;
	/** Ceiling probe: run prose=ultra on the selected split + print gated reduction. */
	ceilingProbe: boolean;
	/** Substance-judge REFERENCE source (default off = current behavior). */
	reference: ReferenceMode;
	/** GOLD model; defaults to the frozen GOLD_MODEL and MUST differ from --model. */
	goldModel: string;
	goldProvider: string;
}

/** Parse + validate `--reference`. PURE. Throws on an unknown value. */
export function parseReferenceArg(raw: string): ReferenceMode {
	if (raw === "off" || raw === "gold") return raw;
	throw new Error(`--reference: expected off|gold, got ${JSON.stringify(raw)}`);
}

/** Parse + validate `--split`. PURE. Throws on an unknown value. */
export function parseSplitArg(raw: string): Split | "all" {
	if (raw === "all") return "all";
	if (isSplit(raw)) return raw;
	throw new Error(`--split: expected tune|validation|test|all, got ${JSON.stringify(raw)}`);
}

function parseRunArgs(argv: string[]): RunConfig {
	const args = argv.slice(2);
	const config: RunConfig = {
		model: "gpt-4o-mini",
		provider: "openai",
		dryRun: false,
		split: "tune",
		repeats: 3,
		judgeModel: JUDGE_MODEL,
		judgeProvider: JUDGE_PROVIDER,
		judgeVersion: "v1",
		ceilingProbe: false,
		reference: "off",
		goldModel: GOLD_MODEL,
		goldProvider: GOLD_PROVIDER,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--model":
				config.model = args[++i];
				break;
			case "--provider":
				config.provider = args[++i];
				break;
			case "--limit":
				config.limit = Number(args[++i]);
				break;
			case "--output":
				config.outputDir = resolve(args[++i]);
				break;
			case "--prompts":
				config.promptsPath = resolve(args[++i]);
				break;
			case "--split":
				config.split = parseSplitArg(args[++i]);
				break;
			case "--repeats": {
				const n = Number(args[++i]);
				if (!Number.isInteger(n) || n < 1) {
					console.error("--repeats must be an integer >= 1");
					process.exit(1);
				}
				config.repeats = n;
				break;
			}
			case "--judge-model":
				config.judgeModel = args[++i];
				break;
			case "--judge-provider":
				config.judgeProvider = args[++i];
				break;
			case "--judge-version":
				config.judgeVersion = parseJudgeVersionArg(args[++i]);
				break;
			case "--ceiling-probe":
				config.ceilingProbe = true;
				break;
			case "--reference":
				config.reference = parseReferenceArg(args[++i]);
				break;
			case "--gold-model":
				config.goldModel = args[++i];
				break;
			case "--gold-provider":
				config.goldProvider = args[++i];
				break;
			case "--dry-run":
				config.dryRun = true;
				break;
			default:
				console.error(`Unknown arg: ${arg}`);
				process.exit(1);
		}
	}
	// Guard the frozen invariant: the judge MUST NOT be the model under test.
	// Model IDENTITY is the anti-gaming dimension, not the provider slug — guard on
	// model id alone so e.g. `gpt-4.1` cannot grade itself by routing via a second
	// provider name (OpenRouter etc.).
	if (config.judgeModel === config.model) {
		console.error(
			`FATAL: judge model (${config.judgeProvider}/${config.judgeModel}) must DIFFER from the ` +
				`model-under-test (${config.provider}/${config.model}) — a model grading its own output is not a gate.`,
		);
		process.exit(1);
	}
	// Same anti-gaming guard for the GOLD author when grading against gold: a model
	// authoring the reference it is graded against is not an unbiased gold. Guard on
	// model identity (not provider) for the same reason as the judge guard above.
	if (config.reference === "gold" && config.goldModel === config.model) {
		console.error(
			`FATAL: GOLD model (${config.goldProvider}/${config.goldModel}) must DIFFER from the ` +
				`model-under-test (${config.provider}/${config.model}) — a model authoring its own reference is not a gate.`,
		);
		process.exit(1);
	}
	return config;
}

// ---------------------------------------------------------------------------
// Logging + response extraction
// ---------------------------------------------------------------------------

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}] ${msg}`);
}

/**
 * Concatenate the text content of the LAST assistant message in a message list.
 * PURE over the message array (no SDK call) — exported so a fixture of messages
 * can be tested without a live session.
 */
export function lastAssistantText(messages: { role: string; content: unknown }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		if (!Array.isArray(m.content)) return "";
		return m.content
			.filter(
				(c): c is { type: string; text: string } =>
					typeof c === "object" &&
					c !== null &&
					(c as { type?: unknown }).type === "text" &&
					typeof (c as { text?: unknown }).text === "string",
			)
			.map((c) => c.text)
			.join("");
	}
	return "";
}

// ---------------------------------------------------------------------------
// Single-condition run (PAID path — never reached in --dry-run)
// ---------------------------------------------------------------------------

async function runCondition(
	spec: PromptSpec,
	condition: ProseCondition,
	config: RunConfig,
	cwd: string,
): Promise<ConditionResult> {
	const model = getModel(config.provider as any, config.model as any);
	if (!model) {
		throw new Error(`Model not found: ${config.provider}/${config.model}`);
	}

	// Fresh settings per condition. For prose-off, disable cave entirely (mirrors
	// run-swebench's --cave off). For prose-full/ultra, enable cave at that intensity.
	const settingsManager = SettingsManager.create(cwd);
	if (condition === "off") {
		settingsManager.setCaveModeEnabled(false);
	} else {
		settingsManager.setCaveModeEnabled(true);
		settingsManager.setCaveModeIntensity(condition);
	}

	// FRESH single-turn Q&A session: NO tools, maxTurns 1, temperature 0.
	// Stability (DD §0.1) = temp=0 deterministic generations + n>=3 REPEATS +
	// variance gate (see runRepeats / outputVariance): any (prompt,condition) whose
	// per-repeat output-token spread exceeds 5% is flagged and EXCLUDED, so an
	// unstable token count can never enter the gated headline.
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off" as ThinkingLevel,
		tools: [],
		maxTurns: 1,
		temperature: 0,
		settingsManager,
		sessionManager: SessionManager.inMemory(cwd),
	});

	// Let the async runtime build settle (mirrors run-swebench).
	await new Promise((r) => setTimeout(r, SESSION_SETTLE_MS));

	// Session-level prose wiring (the system-prompt block honors the session flag).
	if (condition === "off") {
		session.setCaveModeSessionDisabled();
	} else {
		session.setCaveModeSessionIntensity(condition);
	}

	await session.prompt(spec.question, { expandPromptTemplates: false });

	const stats = session.getSessionStats();
	const responseText = lastAssistantText(session.messages as { role: string; content: unknown }[]);

	return {
		usage: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
		},
		responseText,
	};
}

// ---------------------------------------------------------------------------
// A3 — n>=3 repeats per (prompt,condition). Mean output usage + the variance gate.
// ---------------------------------------------------------------------------

/** One condition's repeat set: the mean-token ConditionResult + the variance stat. */
interface RepeatedCondition {
	/** Representative result: mean usage over repeats + last response text. */
	mean: ConditionResult;
	variance: VarianceStat;
}

/**
 * Run `repeats` single-turn calls for one (prompt,condition) and summarize. The
 * representative usage is the MEAN over repeats; the response text kept is the last
 * repeat's (for eyeballing). `variance` flags an unstable token count (>5% spread).
 * PAID path — never reached in --dry-run.
 */
async function runRepeats(
	spec: PromptSpec,
	condition: ProseCondition,
	config: RunConfig,
	cwd: string,
): Promise<RepeatedCondition> {
	const outputs: number[] = [];
	let lastText = "";
	let sumInput = 0;
	let sumOutput = 0;
	let sumCacheRead = 0;
	let sumCacheWrite = 0;
	for (let i = 0; i < config.repeats; i++) {
		const r = await runCondition(spec, condition, config, cwd);
		outputs.push(r.usage.output);
		lastText = r.responseText;
		sumInput += r.usage.input;
		sumOutput += r.usage.output;
		sumCacheRead += r.usage.cacheRead;
		sumCacheWrite += r.usage.cacheWrite;
	}
	const n = config.repeats;
	return {
		mean: {
			usage: {
				input: Math.round(sumInput / n),
				output: Math.round(sumOutput / n),
				cacheRead: Math.round(sumCacheRead / n),
				cacheWrite: Math.round(sumCacheWrite / n),
			},
			responseText: lastText,
		},
		variance: outputVariance(outputs),
	};
}

// ---------------------------------------------------------------------------
// One-shot wiring — cave-DISABLED single-turn sessions on a FROZEN model.
// Used for BOTH the judge (JUDGE_MODEL) and gold authoring (GOLD_MODEL). PAID path.
// ---------------------------------------------------------------------------

/**
 * Build a real injected `runOneShot`: a fresh single-turn, no-tools, cave-DISABLED
 * session on `provider/model` that returns the assistant text. Cave is off so neither
 * the rubric output (judge) nor the gold answer is itself compressed. PAID — only
 * built in main's non-dry-run path; tests inject a stub instead.
 */
function makeOneShot(provider: string, modelId: string, cwd: string, role: string): RunOneShot {
	return async (system: string, user: string): Promise<string> => {
		const model = getModel(provider as any, modelId as any);
		if (!model) throw new Error(`${role} model not found: ${provider}/${modelId}`);
		const settingsManager = SettingsManager.create(cwd);
		settingsManager.setCaveModeEnabled(false);
		const { session } = await createAgentSession({
			cwd,
			model,
			thinkingLevel: "off" as ThinkingLevel,
			tools: [],
			maxTurns: 1,
			temperature: 0,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
		});
		await new Promise((r) => setTimeout(r, SESSION_SETTLE_MS));
		session.setCaveModeSessionDisabled();
		// The SYSTEM rubric is prepended to the user message (single-turn Q&A has no
		// separate system channel here); the model gets the full text. An empty system
		// (the gold prompt is self-contained) just yields a leading blank line.
		await session.prompt(`${system}\n\n${user}`, { expandPromptTemplates: false });
		return lastAssistantText(session.messages as { role: string; content: unknown }[]);
	};
}

/** The judge one-shot, bound to the frozen JUDGE_MODEL. */
function makeJudgeRunOneShot(config: RunConfig, cwd: string): RunOneShot {
	return makeOneShot(config.judgeProvider, config.judgeModel, cwd, "Judge");
}

/** The gold-author one-shot, bound to the frozen GOLD_MODEL. */
function makeGoldRunOneShot(config: RunConfig, cwd: string): RunOneShot {
	return makeOneShot(config.goldProvider, config.goldModel, cwd, "Gold");
}

// ---------------------------------------------------------------------------
// Gold store — frozen-on-disk freeze/reuse over research/evals/prose-gold/<id>.md.
// ---------------------------------------------------------------------------

/** Directory holding the frozen golds, relative to repo root. */
export const GOLD_DIR_REL = "research/evals/prose-gold" as const;

/**
 * Filesystem-backed GoldStore. NOT pure (reads/writes disk) — kept thin: it just maps
 * an id to `<root>/research/evals/prose-gold/<id>.md` and (de)serializes via the PURE
 * helpers. The freeze/reuse DECISION lives in the pure loadOrGenerateGold; this only
 * supplies the read/write boundary. The `<id>.md` files are committed so the freeze is
 * the source of truth.
 */
function makeFsGoldStore(repoRoot: string): GoldStore {
	const dir = join(repoRoot, GOLD_DIR_REL);
	return {
		read(id: string): string | null {
			const path = join(dir, `${id}.md`);
			if (!existsSync(path)) return null;
			return readFileSync(path, "utf8");
		},
		write(id: string, contents: string): void {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${id}.md`), contents);
		},
	};
}

// ---------------------------------------------------------------------------
// Output writers (gated)
// ---------------------------------------------------------------------------

/** Everything captured for one prompt in the gated run (for results.json + responses.md). */
interface FullPromptRecord {
	spec: PromptSpec;
	off: RepeatedCondition;
	candidate: RepeatedCondition;
	/** the prose intensity under test for `candidate` ("full" normally, "ultra" for the probe). */
	candidateCondition: ProseCondition;
	reductionPct: number | null;
	judge: JudgeResult;
	gated: GatedPromptResult;
	/** the resolved gold (id/version/reused) when --reference gold; null in off mode. */
	gold: ResolvedGold | null;
}

function pct(x: number | null): string {
	return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function writeGatedOutputs(
	outputDir: string,
	records: FullPromptRecord[],
	config: RunConfig,
	goldValidations: GoldValidation[],
): void {
	mkdirSync(outputDir, { recursive: true });
	const gatedResults = records.map((r) => r.gated);
	const agg = gatedAggregate(gatedResults);
	const goldSummary = summarizeGoldValidation(goldValidations);

	const resultsJson = {
		generatedAt: new Date().toISOString(),
		config: {
			model: config.model,
			provider: config.provider,
			split: config.split,
			repeats: config.repeats,
			candidateCondition: records[0]?.candidateCondition ?? "full",
		},
		judge: {
			model: config.judgeModel,
			provider: config.judgeProvider,
			promptVersion: selectJudgeSystem(config.judgeVersion).promptVersion,
		},
		// Which judge rubric (v1 literal-ish / v2 semantic) graded this run. Recorded so a
		// report can never silently mix rubrics — both rebase the recall metric differently.
		judgeVersion: config.judgeVersion,
		// Which text the substance judge graded recall/qualifier/added against. The
		// REDUCTION metric is UNAFFECTED by this — always (out_off − out_full)/out_off.
		referenceMode: config.reference,
		// Gold-completeness validation (anti-gaming): per-prompt recall_off_in_gold +
		// flags. A faithful gold retains off-mode substance (recall high); a flagged
		// gold dropped real content and is suspect. Empty in off mode.
		goldValidation: {
			model: config.goldModel,
			provider: config.goldProvider,
			promptVersion: GOLD_PROMPT_VERSION,
			completenessFloor: 0.85,
			nFlagged: goldSummary.nFlagged,
			nTotal: goldSummary.nTotal,
			anySuspect: goldSummary.anySuspect,
			perPrompt: goldValidations.map((v) => ({
				id: v.id,
				recallOffInGold: v.recallOffInGold,
				flagged: v.flagged,
			})),
		},
		honestyNote:
			"GATED OUTPUT-prose compression on SINGLE turns only — a clean but PARTIAL view. " +
			"Headline = gated-median reduction over PASS prompts; only valid when n_pass/n_total >= 0.80. " +
			"REDUCTION is ALWAYS measured vs the verbose OFF baseline; --reference only changes the " +
			"substance-judge reference (off|gold), never the reduction denominator. " +
			"NO bootstrap-CI claim at small n — the per-prompt distribution is reported instead. " +
			"Real savings also come from input/tool-output compression + prompt-cache reuse over long sessions (#36).",
		aggregate: {
			gatedMedianReductionPct: agg.gatedMedianReduction,
			gatedMeanReductionPct: agg.gatedMeanReduction,
			nPass: agg.nPass,
			nTotal: agg.nTotal,
			passRatio: agg.passRatio,
			headlineValid: agg.headlineValid,
		},
		prompts: records.map((r) => ({
			id: r.spec.id,
			genre: r.spec.genre,
			split: r.spec.split,
			note: r.spec.note,
			off: r.off.mean.usage,
			candidate: r.candidate.mean.usage,
			reductionPct: r.reductionPct,
			recall: r.judge.recall,
			qualifierFidelity: r.judge.qualifierFidelity,
			addedUnsupported: r.judge.addedUnsupported,
			// Persist the judge's per-claim rationale so recall / added_unsupported
			// verdicts are auditable post-hoc (council blocker: an unaudited LLM
			// oracle cannot be the sole substance signal).
			judgeClaims: r.judge.claims,
			maxRelSpread: r.gated.maxRelSpread,
			unstable: r.gated.unstable,
			pass: r.gated.pass,
			// The frozen gold this prompt's substance was graded against (gold mode only).
			gold: r.gold
				? { id: r.gold.id, model: r.gold.goldModel, promptVersion: r.gold.promptVersion, reused: r.gold.reused }
				: null,
		})),
	};
	writeFileSync(join(outputDir, "results.json"), JSON.stringify(resultsJson, null, 2));

	// table.md — per-prompt across ALL dimensions + PASS col, then the gated headline.
	const rows = [
		"| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |",
		"| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |",
	];
	for (const r of records) {
		rows.push(
			`| ${r.spec.id} | ${r.spec.genre} | ${r.spec.split} | ${pct(r.reductionPct)} | ` +
				`${r.judge.recall.toFixed(2)} | ${r.judge.qualifierFidelity.toFixed(2)} | ${r.judge.addedUnsupported} | ` +
				`${pct(r.gated.maxRelSpread)} | ${r.gated.pass ? "PASS" : "fail"} |`,
		);
	}
	const md = [
		"# Prose Microbench — GATED output-token reduction (single-turn Q&A)",
		"",
		"> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.",
		"> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.",
		"> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).",
		"",
		`Model-under-test: \`${config.provider}/${config.model}\` | Judge: \`${config.judgeProvider}/${config.judgeModel}\` (${selectJudgeSystem(config.judgeVersion).promptVersion}) | reference: \`${config.reference}\`${config.reference === "gold" ? ` (\`${config.goldProvider}/${config.goldModel}\` ${GOLD_PROMPT_VERSION}; ${goldSummary.nFlagged}/${goldSummary.nTotal} golds flagged)` : ""} | split: \`${config.split}\` | repeats: ${config.repeats}`,
		"",
		rows.join("\n"),
		"",
		`**Gated-median reduction (PASS prompts):** ${pct(agg.gatedMedianReduction)} ` +
			`(mean ${pct(agg.gatedMeanReduction)})`,
		`**n_pass / n_total:** ${agg.nPass} / ${agg.nTotal} (${(agg.passRatio * 100).toFixed(0)}%) — ` +
			`headline ${agg.headlineValid ? "VALID" : "INVALID (need >=80% PASS)"}`,
		"",
	].join("\n");
	writeFileSync(join(outputDir, "table.md"), md);

	// responses.md — off vs candidate text per prompt (quality eyeballable).
	const respLines: string[] = ["# Prose Microbench — responses (off vs candidate)", ""];
	for (const r of records) {
		respLines.push(`## ${r.spec.id} (${r.spec.genre} / ${r.spec.split})`, "");
		respLines.push(`### prose=off (${r.off.mean.usage.output} mean output tokens)`, "", r.off.mean.responseText, "");
		respLines.push(
			`### prose=${r.candidateCondition} (${r.candidate.mean.usage.output} mean output tokens)`,
			"",
			r.candidate.mean.responseText,
			"",
		);
	}
	writeFileSync(join(outputDir, "responses.md"), respLines.join("\n"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function repoRootFromHere(): string {
	// this file lives at <root>/research/evals/run-prompt-prose.ts
	return resolve(fileURLToPath(import.meta.url), "../../..");
}

/** Count prompts per genre (for the dry-run partition summary). PURE. */
export function genreCounts(prompts: PromptSpec[]): Record<Genre, number> {
	const counts: Record<Genre, number> = {
		"code-explain": 0,
		"trade-off": 0,
		"risk-enumeration": 0,
		"multi-step-trace": 0,
		"short-factual": 0,
	};
	for (const p of prompts) counts[p.genre] += 1;
	return counts;
}

async function main(): Promise<void> {
	const config = parseRunArgs(process.argv);
	const repoRoot = repoRootFromHere();

	// Load prompts: override or built-in, then filter by split.
	let allPrompts: PromptSpec[];
	if (config.promptsPath) {
		allPrompts = parsePromptsJsonl(readFileSync(config.promptsPath, "utf8"));
	} else {
		allPrompts = loadBuiltinPrompts(repoRoot);
	}
	let prompts = filterBySplit(allPrompts, config.split);
	if (config.limit && config.limit > 0) prompts = prompts.slice(0, config.limit);

	// Ceiling probe: prose=ultra on the selected split (default tune). Feasibility
	// signal for Phase B (DD §0.1 hard futility stop). Forces the candidate condition.
	const candidateCondition: ProseCondition = config.ceilingProbe ? "ultra" : "full";

	const date = new Date().toISOString().slice(0, 10);
	const probeSuffix = config.ceilingProbe ? "-ceiling" : "";
	const outputDir =
		config.outputDir ?? resolve(repoRoot, "research/results", `prose-${date}-${config.split}${probeSuffix}`);

	log("=== Prose Microbench — GATED (single-turn Q&A, no tools) ===");
	log(`Model-under-test: ${config.provider}/${config.model} | Judge: ${config.judgeProvider}/${config.judgeModel} (${selectJudgeSystem(config.judgeVersion).promptVersion})`);
	log(`Split: ${config.split} | Prompts: ${prompts.length} | Repeats: ${config.repeats} | Candidate prose: ${candidateCondition}`);
	log(`Reference: ${config.reference}${config.reference === "gold" ? ` (GOLD ${config.goldProvider}/${config.goldModel} ${GOLD_PROMPT_VERSION})` : " (verbose off-mode answer — current behavior)"}`);
	if (config.ceilingProbe) log("CEILING PROBE: prose=ultra — feasibility signal for Phase B, NOT a bound on full.");
	log("HONESTY: gated OUTPUT-prose compression, SINGLE turns only — PARTIAL view, NOT total cost (#36).");
	log("REDUCTION is ALWAYS (out_off − out_full)/out_off — --reference only changes the substance-judge reference.");

	if (config.dryRun) {
		log("DRY RUN — NO network/SDK calls. Plan:");
		const counts = genreCounts(prompts);
		log(`Partition '${config.split}' genre breakdown:`);
		for (const g of GENRES) console.log(`  ${g.padEnd(18)} ${counts[g]}`);
		for (const p of prompts) {
			console.log(`  [${p.split}/${p.genre}] ${p.id}  (question ${p.question.length} chars)${p.note ? "  *external-truth*" : ""}`);
		}
		// In gold mode we'd additionally (a) generate any MISSING golds and (b) run one
		// gold-completeness judge call (ref=off, cand=gold) per prompt. Existing golds are
		// REUSED, never regenerated, so the gen count depends on what's already frozen.
		const goldGen = config.reference === "gold" ? prompts.filter((p) => !existsSync(join(repoRoot, GOLD_DIR_REL, `${p.id}.md`))).length : 0;
		const goldValidationCalls = config.reference === "gold" ? prompts.length : 0;
		const calls = prompts.length * 2 * config.repeats + prompts.length + goldGen + goldValidationCalls;
		log(
			`Would run ${prompts.length} prompts × {off, ${candidateCondition}} × ${config.repeats} repeats ` +
				`+ ${prompts.length} judge calls` +
				(config.reference === "gold"
					? ` + ${goldGen} gold GENERATE (missing only; ${prompts.length - goldGen} reused) + ${goldValidationCalls} gold-validation judge calls`
					: "") +
				` = ${calls} single-turn calls (NONE made — dry run).`,
		);
		log(`Ceiling-probe wired: ${config.ceilingProbe ? "ON (prose=ultra)" : "off (pass --ceiling-probe to enable)"}.`);
		return;
	}

	const runOneShot = makeJudgeRunOneShot(config, repoRoot);
	// Resolve the judge rubric ONCE (v1 literal-ish / v2 semantic). Same model + JSON
	// contract; only the SYSTEM rubric text differs. Threaded into every judgeSubstance.
	const judgeSystem = selectJudgeSystem(config.judgeVersion).system;

	// ── GOLD phase (only when --reference gold) ───────────────────────────────────
	// Resolve a frozen gold per prompt (REUSE on-disk, GENERATE only missing), then
	// validate each gold is non-lossy via the EXISTING judge with ref=off, cand=gold.
	// All of this happens BEFORE the substance loop so a suspect gold is surfaced up
	// front. golds[id] feeds selectJudgeReference below.
	const golds = new Map<string, ResolvedGold>();
	const goldValidations: GoldValidation[] = [];
	if (config.reference === "gold") {
		const goldStore = makeFsGoldStore(repoRoot);
		const goldRunOneShot = makeGoldRunOneShot(config, repoRoot);
		const goldOpts = { goldModel: config.goldModel, modelUnderTest: config.model };
		for (const spec of prompts) {
			const goldSpec: GoldSpec = { id: spec.id, question: spec.question };
			const resolved = await loadOrGenerateGold(goldSpec, goldStore, goldRunOneShot, goldOpts);
			golds.set(spec.id, resolved);
			log(`[${spec.id}] gold ${resolved.reused ? "REUSED (frozen)" : "GENERATED"} (${resolved.goldModel} ${resolved.promptVersion})`);
		}
		// Gold-completeness validation: ref=OFF answer, cand=GOLD. A faithful gold keeps
		// off-mode's substance (recall high). We need the off answers; run them first.
		log("Validating gold completeness (recall_off_in_gold) ...");
		for (const spec of prompts) {
			const off = await runRepeats(spec, "off", config, repoRoot);
			const goldText = golds.get(spec.id)?.gold ?? "";
			const v = await judgeSubstance(off.mean.responseText, goldText, runOneShot, judgeSystem);
			const gv = buildGoldValidation(spec.id, v.recall);
			goldValidations.push(gv);
			log(`[${spec.id}] recall_off_in_gold=${gv.recallOffInGold.toFixed(2)}${gv.flagged ? "  ⚠ FLAGGED (gold may be lossy)" : ""}`);
		}
		const gs = summarizeGoldValidation(goldValidations);
		if (gs.anySuspect) {
			log(`⚠ ${gs.nFlagged}/${gs.nTotal} golds FLAGGED as potentially lossy (recall_off_in_gold < 0.85) — review before trusting the gold-reference headline.`);
		}
	}

	const records: FullPromptRecord[] = [];
	for (const spec of prompts) {
		log(`[${spec.id}] prose=off × ${config.repeats} ...`);
		const off = await runRepeats(spec, "off", config, repoRoot);
		log(`[${spec.id}] prose=${candidateCondition} × ${config.repeats} ...`);
		const candidate = await runRepeats(spec, candidateCondition, config, repoRoot);
		// REDUCTION: ALWAYS vs the verbose OFF baseline — UNAFFECTED by --reference. The
		// gold is NEVER the reduction denominator (it is only the substance reference).
		const reductionPct = outputReductionPct(off.mean.usage.output, candidate.mean.usage.output);
		// SUBSTANCE judge reference: off-mode answer (off mode) or frozen gold (gold mode).
		const resolvedGold = golds.get(spec.id) ?? null;
		const judgeReference = selectJudgeReference(config.reference, off.mean.responseText, resolvedGold?.gold ?? null);
		log(`[${spec.id}] judge (substance, ref=${config.reference}) ...`);
		const judge = await judgeSubstance(judgeReference, candidate.mean.responseText, runOneShot, judgeSystem);
		const maxRelSpread = Math.max(off.variance.relSpread, candidate.variance.relSpread);
		const gated = buildGatedPromptResult({
			id: spec.id,
			genre: spec.genre,
			split: spec.split,
			reductionPct,
			judge,
			maxRelSpread,
		});
		log(
			`[${spec.id}] Δ%=${pct(reductionPct)} recall=${judge.recall.toFixed(2)} ` +
				`qualFid=${judge.qualifierFidelity.toFixed(2)} addedUnsup=${judge.addedUnsupported} ` +
				`spread=${pct(maxRelSpread)} -> ${gated.pass ? "PASS" : "fail"}`,
		);
		records.push({ spec, off, candidate, candidateCondition, reductionPct, judge, gated, gold: resolvedGold });
	}

	writeGatedOutputs(outputDir, records, config, goldValidations);
	const agg = gatedAggregate(records.map((r) => r.gated));
	log("=== Gated Results ===");
	log(`Gated-median reduction (PASS prompts): ${pct(agg.gatedMedianReduction)}`);
	log(`n_pass/n_total: ${agg.nPass}/${agg.nTotal} (${(agg.passRatio * 100).toFixed(0)}%) — headline ${agg.headlineValid ? "VALID" : "INVALID"}`);
	if (config.ceilingProbe) {
		log(`CEILING (ultra, gated): ${pct(agg.gatedMedianReduction)} — Phase-B futility input (DD §0.1: <38% ⇒ STOP).`);
	}
	log(`Output dir: ${outputDir}`);
}

// Only run main when executed directly (not when imported by tests, which pull in
// the pure helpers without making any network/SDK calls).
const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
