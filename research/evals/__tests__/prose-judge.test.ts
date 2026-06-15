/**
 * prose-judge.test.ts — unit tests for the FROZEN substance judge. Covers the PURE
 * pieces (parseJudge scoring, the passes() gate truth table) plus judgeSubstance with
 * a MOCKED one-shot (NO network). The frozen identity (JUDGE_MODEL/version) is
 * asserted so an accidental edit during tuning trips a test.
 */

import { describe, expect, it, vi } from "vitest";
import {
	JUDGE_MODEL,
	JUDGE_PROMPT_VERSION,
	JUDGE_PROMPT_VERSION_V2,
	JUDGE_SYSTEM,
	JUDGE_SYSTEM_V2,
	type GateInput,
	buildJudgeUserPrompt,
	judgeSubstance,
	parseJudge,
	parseJudgeVersionArg,
	passes,
	selectJudgeSystem,
} from "../prose-judge.js";

// ---------------------------------------------------------------------------
// Frozen identity — an accidental re-base during tuning trips here.
// ---------------------------------------------------------------------------

describe("frozen judge identity", () => {
	it("judge model is gpt-4.1 (differs from the model-under-test)", () => {
		expect(JUDGE_MODEL).toBe("gpt-4.1");
	});
	it("judge prompt version is v1", () => {
		expect(JUDGE_PROMPT_VERSION).toBe("prose-judge-v1");
	});
	it("v2 prompt version is prose-judge-v2", () => {
		expect(JUDGE_PROMPT_VERSION_V2).toBe("prose-judge-v2");
	});
});

// ---------------------------------------------------------------------------
// v2 SEMANTIC judge — frozen text identity + the v1/v2 rubric switch.
// ---------------------------------------------------------------------------

describe("v2 semantic judge text (frozen identity)", () => {
	it("v2 rubric is committed verbatim with the exact semantic-matching clauses", () => {
		// Frozen-identity assertion: these are the load-bearing sentences from the spec.
		// Drift here re-bases the recall metric and must trip a test.
		expect(JUDGE_SYSTEM_V2).toContain(
			"Extract atomic claims from the REFERENCE. For each, mark PRESENT if the CANDIDATE conveys the",
		);
		expect(JUDGE_SYSTEM_V2).toContain(
			"same information — EVEN IF reworded, reordered, merged with another point, or restructured.",
		);
		expect(JUDGE_SYSTEM_V2).toContain(
			"Mark MISSING only if the information is genuinely absent or contradicted. Do NOT mark a claim",
		);
		expect(JUDGE_SYSTEM_V2).toContain("Be STRICT about genuine omissions");
		expect(JUDGE_SYSTEM_V2).toContain("Do not credit information that is not there.");
		expect(JUDGE_SYSTEM_V2).toContain(
			"qualifierPreserved: a reference claim's correctness condition (only-if / unless / requires /",
		);
		expect(JUDGE_SYSTEM_V2).toContain(
			"Separately count ADDED-UNSUPPORTED claims: candidate claims whose information is absent from,",
		);
	});

	it("v2 keeps the SAME JSON output contract as v1 (parseJudge is reused unchanged)", () => {
		// both rubrics must instruct the identical JSON shape parseJudge consumes
		for (const sys of [JUDGE_SYSTEM, JUDGE_SYSTEM_V2]) {
			expect(sys).toContain('"claims": [');
			expect(sys).toContain('"addedUnsupported": <integer count of candidate-only/contradicting claims>');
		}
	});

	it("v2 differs from v1 (it is a genuinely distinct rubric, not a copy)", () => {
		expect(JUDGE_SYSTEM_V2).not.toBe(JUDGE_SYSTEM);
		// v1's literal-leaning conservatism clause is REPLACED in v2
		expect(JUDGE_SYSTEM).toContain("Be conservative: when a REFERENCE claim is only partially covered, mark present=false.");
		expect(JUDGE_SYSTEM_V2).not.toContain("Be conservative: when a REFERENCE claim is only partially covered");
	});
});

describe("selectJudgeSystem / parseJudgeVersionArg (judge-version switch)", () => {
	it("v1 selects the v1 rubric + version stamp", () => {
		const s = selectJudgeSystem("v1");
		expect(s.system).toBe(JUDGE_SYSTEM);
		expect(s.promptVersion).toBe(JUDGE_PROMPT_VERSION);
	});
	it("v2 selects the v2 rubric + version stamp", () => {
		const s = selectJudgeSystem("v2");
		expect(s.system).toBe(JUDGE_SYSTEM_V2);
		expect(s.promptVersion).toBe(JUDGE_PROMPT_VERSION_V2);
	});
	it("parseJudgeVersionArg accepts v1|v2 and rejects anything else", () => {
		expect(parseJudgeVersionArg("v1")).toBe("v1");
		expect(parseJudgeVersionArg("v2")).toBe("v2");
		expect(() => parseJudgeVersionArg("v3")).toThrow(/expected v1\|v2/);
		expect(() => parseJudgeVersionArg("")).toThrow(/expected v1\|v2/);
	});
});

// ---------------------------------------------------------------------------
// parseJudge — scoring from raw JSON
// ---------------------------------------------------------------------------

const claim = (present: boolean, hasQualifier = false, qualifierPreserved = true) => ({
	text: "c",
	present,
	hasQualifier,
	qualifierPreserved,
});

describe("parseJudge", () => {
	it("computes recall = present / total", () => {
		const raw = JSON.stringify({
			claims: [claim(true), claim(true), claim(false), claim(true)],
			addedUnsupported: 0,
		});
		const r = parseJudge(raw);
		expect(r.recall).toBeCloseTo(0.75, 10);
		expect(r.claims).toHaveLength(4);
	});

	it("computes qualifierFidelity over qualifier-bearing claims only", () => {
		const raw = JSON.stringify({
			claims: [
				claim(true, true, true), // qualifier preserved
				claim(true, true, false), // qualifier dropped/inverted
				claim(true, false, true), // no qualifier — ignored in qualFid
			],
			addedUnsupported: 0,
		});
		const r = parseJudge(raw);
		// 1 of 2 qualifier claims preserved
		expect(r.qualifierFidelity).toBeCloseTo(0.5, 10);
	});

	it("no claims → recall 1, no qualifier claims → qualifierFidelity 1", () => {
		const r = parseJudge(JSON.stringify({ claims: [], addedUnsupported: 0 }));
		expect(r.recall).toBe(1);
		expect(r.qualifierFidelity).toBe(1);
	});

	it("clamps a negative/float addedUnsupported to a non-negative integer", () => {
		expect(parseJudge(JSON.stringify({ claims: [claim(true)], addedUnsupported: -3 })).addedUnsupported).toBe(0);
		expect(parseJudge(JSON.stringify({ claims: [claim(true)], addedUnsupported: 2.6 })).addedUnsupported).toBe(3);
	});

	it("strips a ```json fence before parsing", () => {
		const raw = "```json\n" + JSON.stringify({ claims: [claim(true)], addedUnsupported: 0 }) + "\n```";
		expect(parseJudge(raw).recall).toBe(1);
	});

	it("throws on non-JSON / missing fields rather than fabricating scores", () => {
		expect(() => parseJudge("not json")).toThrow(/not valid JSON/);
		expect(() => parseJudge(JSON.stringify({ addedUnsupported: 0 }))).toThrow(/claims/);
		expect(() => parseJudge(JSON.stringify({ claims: [] }))).toThrow(/addedUnsupported/);
		expect(() => parseJudge(JSON.stringify({ claims: [{ text: "x", present: "yes" }], addedUnsupported: 0 }))).toThrow(
			/present/,
		);
	});
});

// ---------------------------------------------------------------------------
// passes — the DD §0.1 gate truth table
// ---------------------------------------------------------------------------

describe("passes (gate truth table)", () => {
	const ok: GateInput = { reductionPct: 0.4, recall: 0.95, qualifierFidelity: 0.95, addedUnsupported: 0 };

	it("PASSES when all four conditions hold", () => {
		expect(passes(ok)).toBe(true);
	});

	it("FAILS a longer answer (reductionPct <= 0), even with perfect substance", () => {
		expect(passes({ ...ok, reductionPct: -0.1 })).toBe(false);
		expect(passes({ ...ok, reductionPct: 0 })).toBe(false);
	});

	it("FAILS a null reduction (zero-output baseline — no credit for omission)", () => {
		expect(passes({ ...ok, reductionPct: null })).toBe(false);
	});

	it("FAILS low recall (below 0.90 floor)", () => {
		expect(passes({ ...ok, recall: 0.89 })).toBe(false);
		// boundary: exactly 0.90 passes
		expect(passes({ ...ok, recall: 0.9 })).toBe(true);
	});

	it("FAILS a dropped qualifier (qualifierFidelity below 0.90)", () => {
		expect(passes({ ...ok, qualifierFidelity: 0.89 })).toBe(false);
		expect(passes({ ...ok, qualifierFidelity: 0.9 })).toBe(true);
	});

	it("FAILS any hallucination (addedUnsupported > 0)", () => {
		expect(passes({ ...ok, addedUnsupported: 1 })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// judgeSubstance — orchestration with a MOCKED one-shot (no network)
// ---------------------------------------------------------------------------

describe("judgeSubstance (mocked one-shot)", () => {
	it("passes reference+candidate through the frozen prompt and parses the result", async () => {
		const runOneShot = vi.fn(async (_system: string, _user: string) =>
			JSON.stringify({
				claims: [claim(true), claim(true), claim(false)],
				addedUnsupported: 1,
			}),
		);
		const r = await judgeSubstance("REF text", "CAND text", runOneShot);
		expect(r.recall).toBeCloseTo(2 / 3, 10);
		expect(r.addedUnsupported).toBe(1);
		// the injected call saw both the reference and the candidate
		expect(runOneShot).toHaveBeenCalledOnce();
		const userArg = runOneShot.mock.calls[0][1];
		expect(userArg).toContain("REF text");
		expect(userArg).toContain("CAND text");
	});

	it("buildJudgeUserPrompt embeds both reference and candidate", () => {
		const u = buildJudgeUserPrompt("the ref", "the cand");
		expect(u).toContain("REFERENCE:");
		expect(u).toContain("the ref");
		expect(u).toContain("CANDIDATE:");
		expect(u).toContain("the cand");
	});

	it("defaults to the v1 rubric and routes the v2 rubric when selected (parseJudge reused for v2)", async () => {
		const v2Raw = JSON.stringify({
			claims: [claim(true), claim(true), claim(true), claim(false)],
			addedUnsupported: 0,
		});
		const runOneShot = vi.fn(async (_system: string, _user: string) => v2Raw);
		// default → v1 rubric
		await judgeSubstance("REF", "CAND", runOneShot);
		expect(runOneShot.mock.calls[0][0]).toBe(JUDGE_SYSTEM);
		// explicit v2 rubric → the SAME parseJudge scores the SAME JSON shape
		const r = await judgeSubstance("REF", "CAND", runOneShot, selectJudgeSystem("v2").system);
		expect(runOneShot.mock.calls[1][0]).toBe(JUDGE_SYSTEM_V2);
		expect(r.recall).toBeCloseTo(0.75, 10);
		expect(r.addedUnsupported).toBe(0);
	});
});
