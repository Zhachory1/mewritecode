#!/usr/bin/env npx tsx
/**
 * judge-controls.ts — ANTI-RUBBER-STAMP control harness for the prose substance judge.
 *
 * ── WHY THIS EXISTS (the whole point) ────────────────────────────────────────────
 * The v2 judge (prose-judge-v2) replaces v1's literal-ish claim matching with SEMANTIC
 * matching so a faithful-but-reworded candidate stops being miscounted as lossy. But a
 * "semantic" judge that is TOO LENIENT would rubber-stamp EVERYTHING — manufacturing a
 * fake headline by crediting omitted facts, dropped qualifiers, and hallucinations as
 * if substance were preserved. That would be worse than v1.
 *
 * This harness is the NEGATIVE PROOF that v2 is not a rubber stamp. It runs the judge
 * over HAND-WRITTEN (reference, candidate) fixtures with KNOWN ground truth across four
 * control families:
 *
 *   - PARAPHRASE: candidate conveys ALL reference claims, fully reworded/reorganized.
 *     v2 MUST recover them → expected recall >= 0.9. (v2 must PASS where v1 fails;
 *     the harness verdict asserts v2 recall > v1 recall on these — the improvement.)
 *   - OMISSION: candidate genuinely DROPS K of N reference claims.
 *     v2 MUST still catch the drop → recall ~ (N−K)/N (allowing +0.1 slack, NEVER more).
 *     This is the anti-gaming proof: a rubber stamp would score these ~1.0 and FAIL here.
 *   - QUALIFIER-DROP: candidate keeps the claim but drops its only-if/unless condition.
 *     v2 MUST register the loss → qualifierFidelity < 1.
 *   - HALLUCINATION: candidate adds a claim absent from the reference.
 *     v2 MUST flag it → addedUnsupported >= 1.
 *
 * ── TWO MODES ────────────────────────────────────────────────────────────────────
 *  1. MOCKED (unit tests, __tests__/judge-controls.test.ts): the judge is replaced by a
 *     fixture-keyed stub returning canned JSON. The tests assert the HARNESS LOGIC
 *     (scoring, aggregation, per-fixture pass/fail, the v2>v1 + still-catches verdict)
 *     is correct. NO network.
 *  2. REAL-LLM (operator-run, `npx tsx research/evals/judge-controls.ts`): calls the
 *     REAL gpt-4.1 judge under both v1 and v2 on the SAME fixtures to prove the real v2
 *     judge actually behaves correctly on the controls. PAID — NOT run in CI/tests.
 *
 * ── PURITY SPLIT ───────────────────────────────────────────────────────────────
 * The fixtures, the per-fixture expectation checks, the aggregation, and the verdict
 * are PURE. Only `main` (real-LLM mode) does I/O, and it injects a real one-shot. Tests
 * exercise the full pure pipeline against a mocked judge.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel } from "../../packages/ai/src/models.js";
import { createAgentSession } from "../../packages/coding-agent/src/core/sdk.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { SettingsManager } from "../../packages/coding-agent/src/core/settings-manager.js";
import type { ThinkingLevel } from "../../packages/agent/src/index.js";
import {
	JUDGE_MODEL,
	JUDGE_PROVIDER,
	type JudgeResult,
	type JudgeVersion,
	type RunOneShot,
	judgeSubstance,
	selectJudgeSystem,
} from "./prose-judge.js";

// ---------------------------------------------------------------------------
// Control taxonomy + fixtures
// ---------------------------------------------------------------------------

/** The four anti-rubber-stamp control families. */
export type ControlKind = "paraphrase" | "omission" | "qualifier-drop" | "hallucination";

/**
 * One control fixture with KNOWN ground truth. `reference` and `candidate` are hand-
 * written; `expect*` are the truths the judge MUST satisfy for the fixture to "hold".
 *  - paraphrase: set `minRecall` (e.g. 0.9) — candidate conveys all claims, reworded.
 *  - omission: set `nClaims` + `nDropped`; the harness derives expectedRecall=(N−K)/N
 *    and asserts actual recall <= expectedRecall + RECALL_SLACK (MUST still catch drops).
 *  - qualifier-drop: set `maxQualifierFidelity` (< 1) — a dropped condition lowers it.
 *  - hallucination: set `minAddedUnsupported` (>= 1) — an invented claim is flagged.
 */
export interface ControlFixture {
	id: string;
	kind: ControlKind;
	reference: string;
	candidate: string;
	/** paraphrase: minimum acceptable recall (semantic recovery floor). */
	minRecall?: number;
	/** omission: total reference claims (N). */
	nClaims?: number;
	/** omission: claims genuinely dropped by the candidate (K). */
	nDropped?: number;
	/** qualifier-drop: maximum acceptable qualifierFidelity (must register the loss). */
	maxQualifierFidelity?: number;
	/** hallucination: minimum acceptable addedUnsupported count. */
	minAddedUnsupported?: number;
}

/**
 * Slack added to the omission recall ceiling: the judge may credit the SURVIVING claims
 * a touch generously, but NOT the dropped ones. Anything above (N−K)/N + this is a
 * rubber stamp. Deliberately tight (0.1) — this is the anti-gaming guardrail.
 */
export const RECALL_SLACK = 0.1 as const;

/** Expected recall for an omission fixture: surviving / total. PURE. */
export function expectedOmissionRecall(nClaims: number, nDropped: number): number {
	if (nClaims <= 0) throw new Error("expectedOmissionRecall: nClaims must be > 0");
	if (nDropped < 0 || nDropped > nClaims) throw new Error("expectedOmissionRecall: nDropped out of range");
	return (nClaims - nDropped) / nClaims;
}

/**
 * The committed control fixtures. Hand-written, KNOWN ground truth. These are the
 * substance of the deliverable: the omission + qualifier-drop families are what make
 * v2 falsifiable rather than a rubber stamp.
 */
export const CONTROL_FIXTURES: ControlFixture[] = [
	// ── PARAPHRASE: all claims conveyed, fully reworded/reordered → recall >= 0.9 ──────
	{
		id: "para-risks-reordered",
		kind: "paraphrase",
		reference:
			"Running cave-mode always-on risks: (1) terse output confuses new users; " +
			"(2) it can drop nuance in safety-critical explanations; (3) it hurts accessibility " +
			"for screen-reader users; (4) it makes debugging harder when the model omits its reasoning.",
		candidate:
			"Debugging gets harder once the model stops spelling out its reasoning. Screen-reader " +
			"users are worse off too. And newcomers find the clipped phrasing confusing — worst of " +
			"all when safety-critical detail gets compressed away.",
		minRecall: 0.9,
	},
	{
		id: "para-tradeoff-merged",
		kind: "paraphrase",
		reference:
			"Use the median when the cost distribution is skewed or has outliers, because the mean " +
			"is dragged by a few expensive tasks. Use the mean when every task's cost matters equally " +
			"and you need a total-budget figure. Report both when the sample is small.",
		candidate:
			"Skew or outliers? Lead with the median — a handful of pricey tasks yank the mean around. " +
			"When total budget is the question and each task counts the same, the mean is the right " +
			"headline. Small n: just show both.",
		minRecall: 0.9,
	},
	{
		id: "para-trace-restructured",
		kind: "paraphrase",
		reference:
			"When outputOff is 0, outputReductionPct returns null. The aggregate excludes null entries " +
			"rather than counting them as zero. The markdown table renders null as 'n/a'.",
		candidate:
			"A zero off-baseline yields null from outputReductionPct. Downstream, the table prints 'n/a' " +
			"for that prompt, and the aggregate simply skips it (it is not folded in as a 0).",
		minRecall: 0.9,
	},

	// ── OMISSION: K of N claims genuinely dropped → recall <= (N−K)/N + slack ──────────
	{
		// 4 claims, candidate keeps only 2 (drops accessibility + debugging) → 0.5
		id: "omit-2-of-4-risks",
		kind: "omission",
		reference:
			"Running cave-mode always-on risks: (1) terse output confuses new users; " +
			"(2) it can drop nuance in safety-critical explanations; (3) it hurts accessibility " +
			"for screen-reader users; (4) it makes debugging harder when the model omits its reasoning.",
		candidate:
			"Always-on cave mode can confuse new users with its clipped style, and it risks compressing " +
			"away nuance in safety-critical explanations.",
		nClaims: 4,
		nDropped: 2,
	},
	{
		// 3 claims, candidate keeps 2 (drops the small-n 'report both') → ~0.667
		id: "omit-1-of-3-tradeoff",
		kind: "omission",
		reference:
			"Use the median when the cost distribution is skewed or has outliers. Use the mean when every " +
			"task's cost matters equally and you need a total-budget figure. Report both when the sample is small.",
		candidate:
			"Median is best under skew or outliers. The mean is right when each task counts equally and you " +
			"want a total-budget number.",
		nClaims: 3,
		nDropped: 1,
	},
	{
		// 4 claims, candidate keeps 1 (drops 3) → 0.25 — the severe-omission case
		id: "omit-3-of-4-trace",
		kind: "omission",
		reference:
			"Bootstrap of the median: (1) resample the data with replacement; (2) recompute the median per " +
			"iteration; (3) sort the collected medians; (4) read the 2.5th and 97.5th percentiles as the CI.",
		candidate: "You resample the data with replacement many times.",
		nClaims: 4,
		nDropped: 3,
	},

	// ── QUALIFIER-DROP: claim kept, its only-if/unless condition dropped → qualFid < 1 ─
	{
		id: "qual-drop-temp0-determinism",
		kind: "qualifier-drop",
		reference:
			"Setting temperature to 0 makes decoding greedy, which is deterministic ONLY IF there are no " +
			"ties in the logits and the backend runs in a fixed order; otherwise small nondeterminism remains.",
		candidate: "Temperature 0 makes decoding greedy and deterministic.",
		maxQualifierFidelity: 0.99,
	},
	{
		id: "qual-drop-cache-reuse",
		kind: "qualifier-drop",
		reference:
			"Prompt-cache reuse cuts cost, but ONLY when the prefix is byte-identical across turns; any change " +
			"to the system prompt or tool list invalidates the cache and you pay full price again.",
		candidate: "Prompt-cache reuse cuts cost across turns.",
		maxQualifierFidelity: 0.99,
	},

	// ── HALLUCINATION: candidate invents a claim absent from the reference → added >= 1 ─
	{
		id: "halluc-added-metric",
		kind: "hallucination",
		reference:
			"Recall is the fraction of relevant items retrieved: true positives over (true positives plus " +
			"false negatives).",
		candidate:
			"Recall is true positives over (true positives plus false negatives). It is always more important " +
			"than precision in production search systems.",
		minAddedUnsupported: 1,
	},
	{
		id: "halluc-added-step",
		kind: "hallucination",
		reference:
			"The median of an even-length sorted list is the mean of the two central values.",
		candidate:
			"The median of an even-length sorted list is the mean of the two central values, and it always " +
			"equals the arithmetic mean of the whole list.",
		minAddedUnsupported: 1,
	},
];

// ---------------------------------------------------------------------------
// Per-fixture evaluation — PURE (judge result in, expected-vs-actual out)
// ---------------------------------------------------------------------------

/** Per-fixture expected-vs-actual record + the boolean "did the judge satisfy ground truth". */
export interface FixtureEval {
	id: string;
	kind: ControlKind;
	/** The metric the fixture's ground truth bears on. */
	metric: "recall" | "qualifierFidelity" | "addedUnsupported";
	/** Human-readable expectation (e.g. "recall >= 0.9", "recall <= 0.60"). */
	expected: string;
	/** The judge's actual value for `metric`. */
	actual: number;
	/** true when the judge's actual value satisfies the fixture's ground truth. */
	holds: boolean;
}

/**
 * Check ONE fixture's judge result against its KNOWN ground truth. PURE. Returns the
 * expected-vs-actual record + whether it holds. Throws if a fixture is missing the
 * field its kind requires (a malformed control must fail loudly, never silently pass).
 */
export function evalFixture(fx: ControlFixture, judge: JudgeResult): FixtureEval {
	switch (fx.kind) {
		case "paraphrase": {
			if (fx.minRecall === undefined) throw new Error(`fixture ${fx.id}: paraphrase requires minRecall`);
			return {
				id: fx.id,
				kind: fx.kind,
				metric: "recall",
				expected: `recall >= ${fx.minRecall}`,
				actual: judge.recall,
				holds: judge.recall >= fx.minRecall,
			};
		}
		case "omission": {
			if (fx.nClaims === undefined || fx.nDropped === undefined) {
				throw new Error(`fixture ${fx.id}: omission requires nClaims + nDropped`);
			}
			const ceiling = expectedOmissionRecall(fx.nClaims, fx.nDropped) + RECALL_SLACK;
			return {
				id: fx.id,
				kind: fx.kind,
				metric: "recall",
				expected: `recall <= ${ceiling.toFixed(3)} ((N−K)/N + ${RECALL_SLACK})`,
				actual: judge.recall,
				holds: judge.recall <= ceiling,
			};
		}
		case "qualifier-drop": {
			if (fx.maxQualifierFidelity === undefined) {
				throw new Error(`fixture ${fx.id}: qualifier-drop requires maxQualifierFidelity`);
			}
			return {
				id: fx.id,
				kind: fx.kind,
				metric: "qualifierFidelity",
				expected: `qualifierFidelity <= ${fx.maxQualifierFidelity} (dropped condition)`,
				actual: judge.qualifierFidelity,
				holds: judge.qualifierFidelity <= fx.maxQualifierFidelity,
			};
		}
		case "hallucination": {
			if (fx.minAddedUnsupported === undefined) {
				throw new Error(`fixture ${fx.id}: hallucination requires minAddedUnsupported`);
			}
			return {
				id: fx.id,
				kind: fx.kind,
				metric: "addedUnsupported",
				expected: `addedUnsupported >= ${fx.minAddedUnsupported}`,
				actual: judge.addedUnsupported,
				holds: judge.addedUnsupported >= fx.minAddedUnsupported,
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Run the harness over one judge version — INJECTED judge (mockable)
// ---------------------------------------------------------------------------

/**
 * A judge run over a (reference, candidate) under a chosen rubric. INJECTED so tests
 * mock it with fixture-keyed canned JSON results (no network). In real-LLM mode it is
 * bound to judgeSubstance + the v1/v2 system rubric over the real one-shot.
 */
export type JudgeRunner = (fx: ControlFixture, version: JudgeVersion) => Promise<JudgeResult>;

/** Per-version harness result: every fixture's eval + the recall on paraphrase fixtures. */
export interface VersionRun {
	version: JudgeVersion;
	evals: FixtureEval[];
	/** recall per paraphrase fixture id (used for the v2 > v1 improvement assertion). */
	paraphraseRecall: Record<string, number>;
}

/**
 * Run every control fixture through the injected judge under ONE rubric version. The
 * judge result per fixture is evaluated against its ground truth (PURE evalFixture).
 * Returns the per-fixture evals + the paraphrase recalls (for the cross-version verdict).
 */
export async function runControls(
	version: JudgeVersion,
	runJudge: JudgeRunner,
	fixtures: ControlFixture[] = CONTROL_FIXTURES,
): Promise<VersionRun> {
	const evals: FixtureEval[] = [];
	const paraphraseRecall: Record<string, number> = {};
	for (const fx of fixtures) {
		const judge = await runJudge(fx, version);
		const ev = evalFixture(fx, judge);
		evals.push(ev);
		if (fx.kind === "paraphrase") paraphraseRecall[fx.id] = judge.recall;
	}
	return { version, evals, paraphraseRecall };
}

// ---------------------------------------------------------------------------
// Cross-version VERDICT — the gate that accepts or REJECTS v2
// ---------------------------------------------------------------------------

/**
 * The accept/reject verdict on v2 vs v1. BOTH halves must hold or v2 is REJECTED:
 *  - `paraphraseFixed`: v2 recovers paraphrase recall (>= each fixture's floor) AND
 *    v2 recall > v1 recall on EVERY paraphrase fixture (the improvement v2 was built for).
 *  - `stillCatchesOmissions`: v2 still respects the omission ceilings AND the qualifier
 *    + hallucination controls — i.e. v2 is NOT a rubber stamp. A v2 that passed paraphrase
 *    by crediting everything would FAIL here.
 * `accepted` = both.
 */
export interface ControlVerdict {
	paraphraseFixed: boolean;
	stillCatchesOmissions: boolean;
	accepted: boolean;
	/** human-readable reasons (for the report + a failed-assertion message). */
	reasons: string[];
}

/**
 * Compute the accept/reject verdict from the v1 and v2 runs. PURE.
 *
 * paraphraseFixed (the IMPROVEMENT): for every paraphrase fixture, v2's recall must
 *   (a) clear the fixture's floor AND (b) STRICTLY exceed v1's recall. If v2 is no
 *   better than v1 on paraphrase, v2 buys nothing and is rejected.
 *
 * stillCatchesOmissions (the ANTI-RUBBER-STAMP): every NON-paraphrase fixture under v2
 *   must hold its ground truth — omissions stay under the recall ceiling, dropped
 *   qualifiers lower qualifierFidelity, hallucinations are flagged. If any of these fail,
 *   v2 has become a rubber stamp and is rejected regardless of the paraphrase win.
 */
export function computeVerdict(v1: VersionRun, v2: VersionRun): ControlVerdict {
	const reasons: string[] = [];

	// ── Half 1: v2 fixes paraphrase AND beats v1 on it ────────────────────────────
	let paraphraseFixed = true;
	const v2ParaEvals = v2.evals.filter((e) => e.kind === "paraphrase");
	if (v2ParaEvals.length === 0) {
		paraphraseFixed = false;
		reasons.push("no paraphrase fixtures present — cannot demonstrate the v2 improvement");
	}
	for (const e of v2ParaEvals) {
		if (!e.holds) {
			paraphraseFixed = false;
			reasons.push(`v2 fails paraphrase floor on ${e.id}: ${e.expected}, got recall ${e.actual.toFixed(3)}`);
		}
		const v1Recall = v1.paraphraseRecall[e.id];
		const v2Recall = v2.paraphraseRecall[e.id];
		if (v1Recall === undefined || v2Recall === undefined) {
			paraphraseFixed = false;
			reasons.push(`missing paraphrase recall for ${e.id} in v1 or v2 run`);
		} else if (!(v2Recall > v1Recall)) {
			paraphraseFixed = false;
			reasons.push(
				`v2 does NOT beat v1 on paraphrase ${e.id}: v1=${v1Recall.toFixed(3)} v2=${v2Recall.toFixed(3)} ` +
					"(no improvement → v2 buys nothing)",
			);
		}
	}

	// ── Half 2: v2 still catches genuine losses (NOT a rubber stamp) ──────────────
	let stillCatchesOmissions = true;
	for (const e of v2.evals) {
		if (e.kind === "paraphrase") continue;
		if (!e.holds) {
			stillCatchesOmissions = false;
			reasons.push(
				`v2 FAILED the anti-rubber-stamp control ${e.id} (${e.kind}): expected ${e.expected}, ` +
					`got ${e.actual.toFixed(3)} — v2 is rubber-stamping a genuine ${e.kind}`,
			);
		}
	}

	const accepted = paraphraseFixed && stillCatchesOmissions;
	if (accepted) {
		reasons.push(
			"v2 fixes paraphrase (recall up vs v1) AND still catches omissions " +
				"(recall down on omission fixtures, qualifiers + hallucinations flagged) — ACCEPTED.",
		);
	}
	return { paraphraseFixed, stillCatchesOmissions, accepted, reasons };
}

// ---------------------------------------------------------------------------
// Report rendering — PURE
// ---------------------------------------------------------------------------

/** Render the per-fixture expected-vs-actual table + the verdict block. PURE. */
export function renderControlReport(v1: VersionRun, v2: VersionRun, verdict: ControlVerdict): string {
	const lines: string[] = [
		"# Judge anti-rubber-stamp controls — v1 vs v2",
		"",
		"| fixture | kind | metric | expected (v2) | v1 actual | v2 actual | v2 holds |",
		"| --- | --- | --- | --- | ---: | ---: | :---: |",
	];
	const v1ById = new Map(v1.evals.map((e) => [e.id, e]));
	for (const e2 of v2.evals) {
		const e1 = v1ById.get(e2.id);
		const v1Actual = e1 ? e1.actual.toFixed(3) : "—";
		lines.push(
			`| ${e2.id} | ${e2.kind} | ${e2.metric} | ${e2.expected} | ${v1Actual} | ${e2.actual.toFixed(3)} | ` +
				`${e2.holds ? "yes" : "NO"} |`,
		);
	}
	lines.push("", "## Verdict", "");
	lines.push(`- paraphrase fixed (v2 recall up vs v1): **${verdict.paraphraseFixed ? "YES" : "NO"}**`);
	lines.push(`- still catches omissions / qualifiers / hallucinations: **${verdict.stillCatchesOmissions ? "YES" : "NO"}**`);
	lines.push(`- **v2 ${verdict.accepted ? "ACCEPTED" : "REJECTED"}**`);
	lines.push("");
	for (const r of verdict.reasons) lines.push(`- ${r}`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Real-LLM main (operator-run, PAID) — NOT exercised by tests
// ---------------------------------------------------------------------------

/** Build a real JudgeRunner bound to the frozen JUDGE_MODEL over an injected one-shot. */
export function makeRealJudgeRunner(runOneShot: RunOneShot): JudgeRunner {
	return async (fx, version) => {
		const { system } = selectJudgeSystem(version);
		return judgeSubstance(fx.reference, fx.candidate, runOneShot, system);
	};
}

function repoRootFromHere(): string {
	// this file lives at <root>/research/evals/judge-controls.ts
	return resolve(fileURLToPath(import.meta.url), "../../..");
}

/**
 * Real one-shot bound to the frozen JUDGE_MODEL: a fresh single-turn, no-tools, cave-
 * DISABLED session that returns the assistant text. PAID — only built in main. Mirrors
 * run-prompt-prose's makeOneShot.
 */
function makeRealOneShot(cwd: string): RunOneShot {
	return async (system: string, user: string): Promise<string> => {
		const model = getModel(JUDGE_PROVIDER, JUDGE_MODEL);
		if (!model) throw new Error(`Judge model not found: ${JUDGE_PROVIDER}/${JUDGE_MODEL}`);
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
		await new Promise((r) => setTimeout(r, 100));
		session.setCaveModeSessionDisabled();
		await session.prompt(`${system}\n\n${user}`, { expandPromptTemplates: false });
		const messages = session.messages as { role: string; content: unknown }[];
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
			return m.content
				.filter(
					(c): c is { type: string; text: string } =>
						typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text" &&
						typeof (c as { text?: unknown }).text === "string",
				)
				.map((c) => c.text)
				.join("");
		}
		return "";
	};
}

async function main(): Promise<void> {
	const cwd = repoRootFromHere();
	console.log("=== Judge anti-rubber-stamp controls — REAL gpt-4.1 (PAID) ===");
	console.log(`Judge: ${JUDGE_PROVIDER}/${JUDGE_MODEL} | fixtures: ${CONTROL_FIXTURES.length}`);
	const runJudge = makeRealJudgeRunner(makeRealOneShot(cwd));
	const v1 = await runControls("v1", runJudge);
	const v2 = await runControls("v2", runJudge);
	const verdict = computeVerdict(v1, v2);
	console.log(renderControlReport(v1, v2, verdict));
	if (!verdict.accepted) {
		console.error("\nv2 REJECTED by the controls — do NOT adopt v2 as the gate.");
		process.exit(1);
	}
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
