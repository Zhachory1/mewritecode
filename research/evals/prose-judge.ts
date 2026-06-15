/**
 * prose-judge.ts — VERSION-LOCKED substance judge for the prose-40pct gated bench.
 *
 * ── WHY THIS IS FROZEN (read DD §0.1 before touching) ──────────────────────────
 * The gate must NOT be gameable by the tuner. The judge PROMPT TEXT and the judge
 * MODEL are committed to source here and version-locked BEFORE any tuning (Phase B).
 * Phase B may NOT edit JUDGE_PROMPT_VERSION, JUDGE_SYSTEM, the prompt builder, or
 * JUDGE_MODEL — doing so re-bases the metric and invalidates every prior number.
 * The judge model is deliberately DIFFERENT from the model-under-test (default
 * `gpt-4.1`) to reduce shared blind spots: a model grading its own terseness would
 * be the fox guarding the henhouse.
 *
 * The judge extracts ATOMIC claims from the REFERENCE answer and, per claim, decides:
 *   - presence in the CANDIDATE (possibly rephrased / terser) → drives `recall`,
 *   - whether a correctness QUALIFIER (only-if / unless / requires / warning / risk /
 *     edge-case) on that claim is PRESERVED (not dropped or inverted) → drives
 *     `qualifierFidelity`,
 * and separately counts CANDIDATE claims absent from / contradicting the REFERENCE
 *   → `addedUnsupported` (hallucination / precision).
 *
 * ── PURITY SPLIT ───────────────────────────────────────────────────────────────
 * The LLM call is I/O and is INJECTED as `runOneShot` so unit tests mock it with a
 * fixed raw string. Everything else — the prompt text, `parseJudge(raw)`, and the
 * `passes(p)` gate — is PURE and committed, so the tests in __tests__ exercise the
 * full truth table without a single network call.
 */

// ---------------------------------------------------------------------------
// Frozen judge identity — DO NOT EDIT during tuning (DD §0.1).
// ---------------------------------------------------------------------------

/**
 * Judge model. MUST differ from the model-under-test. Strong + cheap-ish. Frozen.
 * Changing this re-bases the metric — any number measured under a different judge
 * model is not comparable and must not be folded into a headline.
 */
export const JUDGE_MODEL = "gpt-4.1" as const;

/** Provider for JUDGE_MODEL. Frozen alongside the model. */
export const JUDGE_PROVIDER = "openai" as const;

/**
 * Version stamp for the frozen judge prompt. Bump ONLY with an explicit re-freeze
 * decision (and then every prior number is invalid). Written into results.json so a
 * report can never silently mix judge versions.
 */
export const JUDGE_PROMPT_VERSION = "prose-judge-v1" as const;

/**
 * Frozen judge SYSTEM instruction. Committed verbatim. Defines the rubric and the
 * exact JSON contract `parseJudge` consumes.
 */
export const JUDGE_SYSTEM = [
	"You are a strict substance-preservation judge for a prose-compression benchmark.",
	"You are given a REFERENCE answer and a CANDIDATE answer to the SAME question.",
	"The CANDIDATE is a compressed rewrite; your job is to detect any loss or distortion of substance.",
	"",
	"Definitions:",
	"- An ATOMIC CLAIM is a single, independently-checkable assertion from the REFERENCE",
	"  (one fact, one step, one trade-off, one risk). Split compound sentences into atoms.",
	"- A CLAIM carries a QUALIFIER when its correctness depends on a condition: only-if / unless /",
	"  requires / except / warning / risk / edge-case / 'not safe when ...'. Pure filler hedging",
	'  ("basically", "I think", "in general") is NOT a qualifier.',
	"",
	"For EACH atomic claim in the REFERENCE decide:",
	'  - present: true if the CANDIDATE states it (rephrased/terser is fine), else false.',
	"  - hasQualifier: true if the REFERENCE claim carries a correctness qualifier (per above).",
	"  - qualifierPreserved: if hasQualifier, true only when the CANDIDATE keeps that condition,",
	"    NOT dropped and NOT inverted. If hasQualifier is false, set qualifierPreserved to true.",
	"",
	"Separately count ADDED-UNSUPPORTED claims: assertions the CANDIDATE makes that are absent from,",
	"or contradict, the REFERENCE (hallucination / precision failure).",
	"",
	"Output STRICT JSON ONLY (no prose, no markdown fence), exactly this shape:",
	"{",
	'  "claims": [',
	'    { "text": "<atomic claim>", "present": <bool>, "hasQualifier": <bool>, "qualifierPreserved": <bool> }',
	"  ],",
	'  "addedUnsupported": <integer count of candidate-only/contradicting claims>',
	"}",
	"Be conservative: when a REFERENCE claim is only partially covered, mark present=false.",
].join("\n");

// ---------------------------------------------------------------------------
// V2 judge identity — SEMANTIC-matching rubric (A/B against v1; v1 is untouched).
// ---------------------------------------------------------------------------
//
// WHY V2 EXISTS (read before touching): v1 does literal-ish claim matching and
// demonstrably UNDER-COUNTS recall when a faithful-but-terse candidate REWORDS,
// REORDERS, MERGES, or RESTRUCTURES the reference's claims (proven: a gold and an
// off-mode answer enumerating the SAME risks scored only 0.25 matched under v1).
// v2 instructs the judge to credit information conveyed by ANY phrasing/structure,
// while staying STRICT about genuine omissions, dropped qualifiers, and
// hallucinations. v2 reuses the SAME JUDGE_MODEL and the SAME JSON output shape as
// v1 (so parseJudge and buildJudgeUserPrompt are reused unchanged) — only the SYSTEM
// rubric differs. v2 is NOT lenient: the anti-rubber-stamp controls in
// judge-controls.ts prove v2 still FAILS genuine omissions / dropped qualifiers /
// hallucinations. A "semantic" judge that rubber-stamped everything would manufacture
// a fake headline; the controls are the negative proof that it does not.

/**
 * Version stamp for the v2 (semantic-matching) judge prompt. Committed alongside v1;
 * selected via the `--judge-version` flag. Written into results.json as `judgeVersion`
 * so a report can never silently mix judge rubrics.
 */
export const JUDGE_PROMPT_VERSION_V2 = "prose-judge-v2" as const;

/**
 * Frozen v2 judge SYSTEM instruction. Committed verbatim. SEMANTIC matching: credit a
 * reference claim as PRESENT when the candidate conveys the SAME INFORMATION by any
 * phrasing/structure, but mark MISSING (strictly) when the information is genuinely
 * absent or contradicted. Same JSON contract as v1 → parseJudge is reused unchanged.
 */
export const JUDGE_SYSTEM_V2 = [
	"You are a strict substance-preservation judge for a prose-compression benchmark.",
	"You are given a REFERENCE answer and a CANDIDATE answer to the SAME question.",
	"The CANDIDATE is a compressed rewrite; your job is to detect any loss or distortion of substance.",
	"",
	"Definitions:",
	"- An ATOMIC CLAIM is a single, independently-checkable assertion from the REFERENCE",
	"  (one fact, one step, one trade-off, one risk). Split compound sentences into atoms.",
	"- A CLAIM carries a QUALIFIER when its correctness depends on a condition: only-if / unless /",
	"  requires / except / warning / risk / edge-case / 'not safe when ...'. Pure filler hedging",
	'  ("basically", "I think", "in general") is NOT a qualifier.',
	"",
	"Extract atomic claims from the REFERENCE. For each, mark PRESENT if the CANDIDATE conveys the",
	"same information — EVEN IF reworded, reordered, merged with another point, or restructured.",
	"Mark MISSING only if the information is genuinely absent or contradicted. Do NOT mark a claim",
	"missing merely because the wording or structure differs.",
	"",
	"Be STRICT about genuine omissions: if a reference claim's information is not recoverable from",
	"the candidate, it is MISSING. Do not credit information that is not there.",
	"",
	"For EACH atomic claim in the REFERENCE decide:",
	'  - present: true if the CANDIDATE conveys the same information (any wording/structure), else false.',
	"  - hasQualifier: true if the REFERENCE claim carries a correctness qualifier (per above).",
	"  - qualifierPreserved: a reference claim's correctness condition (only-if / unless / requires /",
	"    risk / warning) counts preserved ONLY IF the candidate still carries that condition. Rewording",
	"    the condition is OK; DROPPING or INVERTING it is NOT. If hasQualifier is false, set",
	"    qualifierPreserved to true.",
	"",
	"Separately count ADDED-UNSUPPORTED claims: candidate claims whose information is absent from,",
	"or contradicts, the REFERENCE (hallucination / precision failure).",
	"",
	"Output STRICT JSON ONLY (no prose, no markdown fence), exactly this shape:",
	"{",
	'  "claims": [',
	'    { "text": "<atomic claim>", "present": <bool>, "hasQualifier": <bool>, "qualifierPreserved": <bool> }',
	"  ],",
	'  "addedUnsupported": <integer count of candidate-only/contradicting claims>',
	"}",
	"Credit reworded/reordered/merged information as present; mark missing only on genuine omission or contradiction.",
].join("\n");

/** The two judge rubric versions selectable via `--judge-version`. */
export type JudgeVersion = "v1" | "v2";

/**
 * Select the frozen SYSTEM rubric + its version stamp for a given judge version. PURE.
 * v1 is the literal-ish frozen baseline; v2 is the semantic-matching rubric. The MODEL
 * and the JSON contract are identical across versions — only the rubric text differs.
 */
export function selectJudgeSystem(version: JudgeVersion): { system: string; promptVersion: string } {
	if (version === "v2") return { system: JUDGE_SYSTEM_V2, promptVersion: JUDGE_PROMPT_VERSION_V2 };
	return { system: JUDGE_SYSTEM, promptVersion: JUDGE_PROMPT_VERSION };
}

/** Parse + validate a `--judge-version` value. PURE. Throws on an unknown value. */
export function parseJudgeVersionArg(raw: string): JudgeVersion {
	if (raw === "v1" || raw === "v2") return raw;
	throw new Error(`--judge-version: expected v1|v2, got ${JSON.stringify(raw)}`);
}

/**
 * Build the frozen judge USER message. PURE + committed. `reference` is the off-mode
 * answer (the substance baseline); `candidate` is the compressed answer under test.
 */
export function buildJudgeUserPrompt(reference: string, candidate: string): string {
	return [
		"REFERENCE:",
		'"""',
		reference,
		'"""',
		"",
		"CANDIDATE:",
		'"""',
		candidate,
		'"""',
		"",
		"Return the strict JSON described in the system instruction. No other text.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One atomic-claim verdict from the judge. */
export interface JudgeClaim {
	text: string;
	present: boolean;
	hasQualifier: boolean;
	qualifierPreserved: boolean;
}

/** Parsed, scored judge result over one (reference, candidate) pair. */
export interface JudgeResult {
	/** fraction of REFERENCE claims present in CANDIDATE, in [0,1]. */
	recall: number;
	/** of REFERENCE claims carrying a qualifier, fraction preserved, in [0,1]. */
	qualifierFidelity: number;
	/** count of CANDIDATE claims absent from / contradicting REFERENCE. */
	addedUnsupported: number;
	/** the per-claim verdicts (for the report / responses.md). */
	claims: JudgeClaim[];
}

/** Injected one-shot LLM call: prompt in, raw completion text out. Mocked in tests. */
export type RunOneShot = (system: string, user: string) => Promise<string>;

// ---------------------------------------------------------------------------
// parseJudge — PURE. Parse + score the judge's raw JSON into a JudgeResult.
// ---------------------------------------------------------------------------

/**
 * Parse the judge's raw output (strict JSON, optionally wrapped in a ```json fence)
 * into a scored JudgeResult. PURE. Throws loudly on malformed output rather than
 * fabricating scores — a broken judge response must fail the run, never silently
 * pass it.
 *
 * Scoring (committed, not tunable):
 *  - recall = (# claims with present===true) / (# claims). No claims → recall 1
 *    (a REFERENCE with zero atomic claims has nothing to lose; reductionPct still
 *    gates the win, so this cannot manufacture a pass on a longer answer).
 *  - qualifierFidelity = (# qualifier claims with qualifierPreserved===true) /
 *    (# qualifier claims). No qualifier claims → 1 (nothing to preserve).
 *  - addedUnsupported = the reported integer count (clamped to >= 0).
 */
export function parseJudge(raw: string): JudgeResult {
	const stripped = stripJsonFence(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped);
	} catch {
		throw new Error("prose-judge: judge output is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("prose-judge: judge output is not a JSON object");
	}
	const obj = parsed as Record<string, unknown>;

	if (!Array.isArray(obj.claims)) {
		throw new Error("prose-judge: judge output missing array field 'claims'");
	}
	const claims: JudgeClaim[] = obj.claims.map((c, i) => {
		if (typeof c !== "object" || c === null) {
			throw new Error(`prose-judge: claims[${i}] is not an object`);
		}
		const o = c as Record<string, unknown>;
		if (typeof o.text !== "string") throw new Error(`prose-judge: claims[${i}].text not a string`);
		if (typeof o.present !== "boolean") throw new Error(`prose-judge: claims[${i}].present not a bool`);
		if (typeof o.hasQualifier !== "boolean") throw new Error(`prose-judge: claims[${i}].hasQualifier not a bool`);
		if (typeof o.qualifierPreserved !== "boolean") {
			throw new Error(`prose-judge: claims[${i}].qualifierPreserved not a bool`);
		}
		return {
			text: o.text,
			present: o.present,
			hasQualifier: o.hasQualifier,
			qualifierPreserved: o.qualifierPreserved,
		};
	});

	if (typeof obj.addedUnsupported !== "number" || !Number.isFinite(obj.addedUnsupported)) {
		throw new Error("prose-judge: judge output missing numeric 'addedUnsupported'");
	}
	const addedUnsupported = Math.max(0, Math.round(obj.addedUnsupported));

	const total = claims.length;
	const present = claims.filter((c) => c.present).length;
	const recall = total === 0 ? 1 : present / total;

	const qualClaims = claims.filter((c) => c.hasQualifier);
	const qualPreserved = qualClaims.filter((c) => c.qualifierPreserved).length;
	const qualifierFidelity = qualClaims.length === 0 ? 1 : qualPreserved / qualClaims.length;

	return { recall, qualifierFidelity, addedUnsupported, claims };
}

/** Strip an optional ```json ... ``` (or bare ``` ... ```) fence. PURE. */
function stripJsonFence(raw: string): string {
	const t = raw.trim();
	if (!t.startsWith("```")) return t;
	const firstNl = t.indexOf("\n");
	if (firstNl < 0) return t;
	let body = t.slice(firstNl + 1);
	const lastFence = body.lastIndexOf("```");
	if (lastFence >= 0) body = body.slice(0, lastFence);
	return body.trim();
}

// ---------------------------------------------------------------------------
// passes — PURE gate. The single source of truth for "this prompt is a win".
// ---------------------------------------------------------------------------

/** The dimensions the gate reads. A superset is fine (per-prompt aggregate carries more). */
export interface GateInput {
	/** out-token reduction off→full, in [−∞,1]. null (zero baseline) never passes. */
	reductionPct: number | null;
	recall: number;
	qualifierFidelity: number;
	addedUnsupported: number;
}

/** Frozen gate thresholds (DD §0.1). */
export const RECALL_FLOOR = 0.9 as const;
export const QUALIFIER_FIDELITY_FLOOR = 0.9 as const;

/**
 * Per-prompt PASS gate (DD §0.1). PURE. ALL must hold:
 *   reductionPct > 0  (a longer/equal answer is NOT a win — no credit for omission
 *                      via a null/zero-baseline either)
 *   recall >= 0.90
 *   qualifierFidelity >= 0.90
 *   addedUnsupported === 0
 */
export function passes(p: GateInput): boolean {
	if (p.reductionPct === null) return false;
	return (
		p.reductionPct > 0 &&
		p.recall >= RECALL_FLOOR &&
		p.qualifierFidelity >= QUALIFIER_FIDELITY_FLOOR &&
		p.addedUnsupported === 0
	);
}

// ---------------------------------------------------------------------------
// judgeSubstance — the I/O orchestrator. The LLM call is injected.
// ---------------------------------------------------------------------------

/**
 * Score one (reference, candidate) pair through the frozen judge. The actual LLM
 * call is the injected `runOneShot` — so this whole function is testable by passing
 * a stub that returns a fixed raw JSON string (NO network). In production `main`
 * passes a real one-shot bound to JUDGE_MODEL. Returns the scored JudgeResult.
 *
 * `system` selects the rubric: defaults to the v1 JUDGE_SYSTEM (backward-compatible);
 * pass JUDGE_SYSTEM_V2 (via selectJudgeSystem) to grade under the semantic v2 rubric.
 * Only the rubric text varies — the JSON contract parseJudge consumes is identical.
 */
export async function judgeSubstance(
	reference: string,
	candidate: string,
	runOneShot: RunOneShot,
	system: string = JUDGE_SYSTEM,
): Promise<JudgeResult> {
	const user = buildJudgeUserPrompt(reference, candidate);
	const raw = await runOneShot(system, user);
	return parseJudge(raw);
}
