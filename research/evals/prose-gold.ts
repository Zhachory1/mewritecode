/**
 * prose-gold.ts — GOLD-reference generation + freeze for the prose-40pct bench.
 *
 * ── WHY GOLD EXISTS (anti-bias, read before touching) ───────────────────────────
 * The default substance judge grades the CANDIDATE (caveman/prose-full) recall
 * against the OFF-mode answer. But the off-mode answer is PADDED: it carries
 * pleasantries, hedging, and redundancy alongside its real substance. Grading recall
 * against that padded baseline can WRONGLY penalize caveman for dropping FILLER as if
 * it dropped FACTS — biasing recall down and the headline against caveman.
 *
 * A GOLD reference is a frozen, COMPLETE-but-terse answer: every substantive point,
 * condition, qualifier, caveat, and edge case retained, with ONLY filler removed.
 * Grading recall against the gold removes the filler-as-recall-loss bias.
 *
 * ── ANTI-GAMING SAFEGUARDS (these are REAL, not decorative) ──────────────────────
 *  1. GOLD model identity is guarded to DIFFER from the model-under-test (same guard
 *     class as the judge — a model must not grade against its own preferred phrasing).
 *  2. Golds are FROZEN ON DISK before any measurement: if a gold file exists it is
 *     REUSED, never regenerated. You cannot regenerate a gold to conveniently move a
 *     number — the on-disk file is the committed source of truth.
 *  3. The gold MUST be validated as NON-LOSSY: we run the EXISTING frozen judge with
 *     reference=off, candidate=gold and require recall_off_in_gold to be high. A gold
 *     that drops real off-mode substance is FLAGGED (suspect) — proving the gold is a
 *     faithful complete answer and not an artificially terse one that drops content.
 *
 * The GOLD generation prompt PRIORITIZES COMPLETENESS over brevity. It must NEVER
 * instruct terseness in a way that drops content.
 *
 * ── PURITY SPLIT ───────────────────────────────────────────────────────────────
 * The LLM call is INJECTED as `runOneShot`, and the on-disk freeze is split into PURE
 * (de)serialization helpers (`parseGoldFile` / `serializeGoldFile`) plus a thin I/O
 * shell (`loadOrGenerateGold`) that decides reuse-vs-generate. Tests mock the LLM and
 * the filesystem boundary so the full freeze/reuse/guard truth table runs with NO
 * network and NO real generation.
 */

import type { RunOneShot } from "./prose-judge.js";

// ---------------------------------------------------------------------------
// Frozen GOLD identity — DO NOT EDIT during tuning (same discipline as the judge).
// ---------------------------------------------------------------------------

/**
 * GOLD model. MUST differ from the model-under-test (anti-self-grading: a gold
 * authored by the same model the bench is grading would encode that model's own
 * phrasing preferences into the reference). Frozen.
 */
export const GOLD_MODEL = "gpt-4.1" as const;

/** Provider for GOLD_MODEL. Frozen alongside the model. */
export const GOLD_PROVIDER = "openai" as const;

/**
 * Version stamp for the frozen GOLD generation prompt. Bump ONLY with an explicit
 * re-freeze decision — and then every gold generated under a prior version is stale
 * and must be regenerated (the version is written into the gold file header so a
 * report can never silently mix gold-prompt versions). Stored on disk per gold.
 */
export const GOLD_PROMPT_VERSION = "prose-gold-v1" as const;

// ---------------------------------------------------------------------------
// buildGoldPrompt — the frozen, committed generation prompt. PURE.
// ---------------------------------------------------------------------------

/**
 * Build the frozen GOLD generation prompt (system rubric + the question), returned as
 * one string suitable for the injected single-turn `runOneShot`. PURE + committed.
 *
 * COMPLETENESS FIRST. The rubric tells the model to write the COMPLETE correct answer
 * — every substantive point, condition, qualifier, caveat, and edge case — and to
 * omit ONLY filler, pleasantries, hedging, and redundancy. It explicitly forbids
 * compressing at the cost of any fact. Brevity is strictly secondary to completeness:
 * this is the reference recall is graded against, so a lossy gold would re-introduce
 * the very bias the gold exists to remove.
 */
export function buildGoldPrompt(question: string): string {
	const system = [
		"You are writing a GOLD reference answer for a substance-preservation benchmark.",
		"Your answer becomes the COMPLETE, authoritative reference that other answers are graded against for recall.",
		"",
		"REQUIREMENTS — completeness first, brevity second:",
		"- Include EVERY substantive point, condition, qualifier, caveat, and edge case needed to FULLY answer the question.",
		"- Preserve every correctness qualifier (only-if / unless / requires / except / warning / risk / edge-case).",
		"- Omit ONLY filler, pleasantries, hedging, and redundancy. Nothing substantive.",
		"- Do NOT compress at the cost of any fact. If brevity would drop a point, keep the point.",
		"- Completeness is the priority. Be terse in STYLE, never lossy in CONTENT.",
		"",
		"Write the answer as plain prose or a tight list. No preamble, no meta-commentary, no sign-off.",
	].join("\n");
	const user = ["QUESTION:", '"""', question, '"""', "", "Write the COMPLETE gold answer now."].join("\n");
	return `${system}\n\n${user}`;
}

// ---------------------------------------------------------------------------
// Anti-self-grading guard — GOLD_MODEL must differ from the model-under-test.
// ---------------------------------------------------------------------------

/**
 * Assert the GOLD model is NOT the model-under-test. PURE. Guards on the model id
 * alone (identity is the anti-gaming dimension, not the provider slug — so a model
 * cannot author its own gold by routing through a second provider name). Throws with
 * a loud message; callers surface this as a fatal config error (same shape as the
 * judge guard in run-prompt-prose).
 */
export function assertGoldModelDiffers(goldModel: string, modelUnderTest: string): void {
	if (goldModel === modelUnderTest) {
		throw new Error(
			`FATAL: GOLD model (${goldModel}) must DIFFER from the model-under-test (${modelUnderTest}) — ` +
				"a model authoring the reference it is graded against is not an unbiased gold.",
		);
	}
}

// ---------------------------------------------------------------------------
// Gold file (de)serialization — PURE. The on-disk frozen format.
// ---------------------------------------------------------------------------

/** A parsed gold file: the frozen header fields + the gold answer body. */
export interface GoldFile {
	/** Prompt id this gold answers. */
	id: string;
	/** GOLD_MODEL that authored it (frozen-stamp for audit). */
	goldModel: string;
	/** GOLD_PROMPT_VERSION it was generated under (frozen-stamp for audit). */
	promptVersion: string;
	/** The exact question text (frozen with the gold so a corpus edit is detectable). */
	question: string;
	/** The gold answer body. */
	gold: string;
}

const HEADER_FENCE = "---";

/**
 * Serialize a GoldFile to the on-disk markdown format. PURE. A small YAML-ish header
 * (fenced by `---`) carries the audit fields, followed by the gold body. The question
 * is base64-encoded in the header so a multi-line question can never corrupt the
 * single-line `key: value` header grammar (and so parse is unambiguous).
 */
export function serializeGoldFile(g: GoldFile): string {
	const header = [
		HEADER_FENCE,
		`id: ${g.id}`,
		`goldModel: ${g.goldModel}`,
		`promptVersion: ${g.promptVersion}`,
		`questionB64: ${Buffer.from(g.question, "utf8").toString("base64")}`,
		HEADER_FENCE,
	].join("\n");
	// Trailing newline keeps the body separated from the header and is git-friendly.
	return `${header}\n${g.gold}\n`;
}

/**
 * Parse the on-disk gold markdown back into a GoldFile. PURE. Throws loudly on a
 * malformed header / missing field rather than silently returning a partial gold — a
 * corrupted frozen gold must fail the run, never be measured against. The body is
 * everything after the closing header fence (trailing newline trimmed).
 */
export function parseGoldFile(contents: string): GoldFile {
	const lines = contents.split("\n");
	if (lines[0] !== HEADER_FENCE) {
		throw new Error("prose-gold: gold file missing opening '---' header fence");
	}
	let closeIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === HEADER_FENCE) {
			closeIdx = i;
			break;
		}
	}
	if (closeIdx === -1) {
		throw new Error("prose-gold: gold file missing closing '---' header fence");
	}
	const header: Record<string, string> = {};
	for (let i = 1; i < closeIdx; i++) {
		const line = lines[i];
		const sep = line.indexOf(": ");
		if (sep < 0) throw new Error(`prose-gold: malformed header line: ${JSON.stringify(line)}`);
		header[line.slice(0, sep)] = line.slice(sep + 2);
	}
	const id = header.id;
	const goldModel = header.goldModel;
	const promptVersion = header.promptVersion;
	const questionB64 = header.questionB64;
	if (!id) throw new Error("prose-gold: gold header missing 'id'");
	if (!goldModel) throw new Error("prose-gold: gold header missing 'goldModel'");
	if (!promptVersion) throw new Error("prose-gold: gold header missing 'promptVersion'");
	if (!questionB64) throw new Error("prose-gold: gold header missing 'questionB64'");
	const question = Buffer.from(questionB64, "base64").toString("utf8");
	// Body: lines after the closing fence, with a single trailing newline trimmed.
	const body = lines.slice(closeIdx + 1).join("\n");
	const gold = body.endsWith("\n") ? body.slice(0, -1) : body;
	return { id, goldModel, promptVersion, question, gold };
}

// ---------------------------------------------------------------------------
// generateGold — the injected LLM call. The actual SDK call is `runOneShot`.
// ---------------------------------------------------------------------------

/** What `generateGold` needs about a prompt. */
export interface GoldSpec {
	id: string;
	question: string;
}

/**
 * Generate a gold answer for one prompt via the injected one-shot. The model identity
 * guard runs FIRST (fatal if GOLD_MODEL === model-under-test). The single-turn call is
 * INJECTED (`runOneShot`) so tests mock it with NO network and NO real generation.
 * Returns the trimmed gold body. Throws if the model returns empty text (an empty gold
 * would silently make every recall 1 — a faithful gold must have content).
 */
export async function generateGold(
	spec: GoldSpec,
	runOneShot: RunOneShot,
	opts: { goldModel: string; modelUnderTest: string },
): Promise<string> {
	assertGoldModelDiffers(opts.goldModel, opts.modelUnderTest);
	const prompt = buildGoldPrompt(spec.question);
	// runOneShot's (system, user) signature: the gold prompt is self-contained, so the
	// rubric+question rides as the user message with an empty system (the single-turn
	// judge wiring concatenates them anyway). Kept symmetric with the judge call site.
	const raw = await runOneShot("", prompt);
	const gold = raw.trim();
	if (gold === "") {
		throw new Error(`prose-gold: GOLD model returned empty text for prompt '${spec.id}'`);
	}
	return gold;
}

// ---------------------------------------------------------------------------
// loadOrGenerateGold — FREEZE-OR-REUSE. Thin I/O shell over the pure helpers.
// ---------------------------------------------------------------------------

/** Filesystem boundary, injected so the freeze/reuse logic is unit-testable. */
export interface GoldStore {
	/** Return the file contents if it exists, else null. */
	read(id: string): string | null;
	/** Persist the serialized gold file for `id`. */
	write(id: string, contents: string): void;
}

/** Result of resolving one gold: the body + whether it was reused from disk. */
export interface ResolvedGold {
	id: string;
	gold: string;
	/** true = the frozen on-disk file was reused (NOT regenerated). */
	reused: boolean;
	/** the frozen-stamp the resolved gold carries. */
	goldModel: string;
	promptVersion: string;
}

/**
 * Resolve a gold for one prompt with FREEZE-OR-REUSE semantics:
 *  - If a gold file EXISTS for the id, REUSE it (parse + return). NEVER regenerate —
 *    the on-disk gold is the committed, frozen source of truth. A frozen gold whose
 *    stored question no longer matches the corpus question throws (corpus drift must
 *    be caught, not silently graded against a stale reference).
 *  - Otherwise GENERATE (paid path via the injected runOneShot), serialize, persist,
 *    and return it with `reused: false`.
 *
 * The LLM call and the filesystem are both injected, so tests assert "existing file is
 * NOT regenerated" and "missing file IS generated once" with no network/disk.
 */
export async function loadOrGenerateGold(
	spec: GoldSpec,
	store: GoldStore,
	runOneShot: RunOneShot,
	opts: { goldModel: string; modelUnderTest: string },
): Promise<ResolvedGold> {
	const existing = store.read(spec.id);
	if (existing !== null) {
		const parsed = parseGoldFile(existing);
		if (parsed.question !== spec.question) {
			throw new Error(
				`prose-gold: frozen gold for '${spec.id}' was generated for a DIFFERENT question ` +
					"(corpus drift) — refusing to grade against a stale reference. Re-freeze deliberately if intended.",
			);
		}
		return {
			id: parsed.id,
			gold: parsed.gold,
			reused: true,
			goldModel: parsed.goldModel,
			promptVersion: parsed.promptVersion,
		};
	}
	const gold = await generateGold(spec, runOneShot, opts);
	const file: GoldFile = {
		id: spec.id,
		goldModel: opts.goldModel,
		promptVersion: GOLD_PROMPT_VERSION,
		question: spec.question,
		gold,
	};
	store.write(spec.id, serializeGoldFile(file));
	return { id: spec.id, gold, reused: false, goldModel: opts.goldModel, promptVersion: GOLD_PROMPT_VERSION };
}

// ---------------------------------------------------------------------------
// Gold-completeness validation — anti-gaming: the gold must NOT be lossy. PURE.
// ---------------------------------------------------------------------------

/** Frozen floor: recall_off_in_gold below this flags the gold as suspect (lossy). */
export const GOLD_COMPLETENESS_FLOOR = 0.85 as const;

/** Per-prompt gold-validation record (built from the off→gold judge result). */
export interface GoldValidation {
	id: string;
	/** recall of OFF-mode substance present in the GOLD (judge: ref=off, cand=gold). */
	recallOffInGold: number;
	/** true when recallOffInGold < GOLD_COMPLETENESS_FLOOR — gold dropped real substance. */
	flagged: boolean;
}

/**
 * Build a gold-validation record from the off→gold recall. PURE. A faithful gold
 * retains off-mode's substance, so recallOffInGold should be high (≈≥0.9); below the
 * 0.85 floor the gold is FLAGGED as suspect (it dropped real content, re-introducing
 * the bias the gold exists to remove) so the operator can exclude/regenerate it.
 */
export function buildGoldValidation(id: string, recallOffInGold: number): GoldValidation {
	return { id, recallOffInGold, flagged: recallOffInGold < GOLD_COMPLETENESS_FLOOR };
}

/** Aggregate gold-validation: count flagged golds + whether ANY gold is suspect. PURE. */
export function summarizeGoldValidation(validations: GoldValidation[]): {
	nFlagged: number;
	nTotal: number;
	anySuspect: boolean;
} {
	const nFlagged = validations.filter((v) => v.flagged).length;
	return { nFlagged, nTotal: validations.length, anySuspect: nFlagged > 0 };
}
