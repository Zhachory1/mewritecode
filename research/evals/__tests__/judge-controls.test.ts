/**
 * judge-controls.test.ts — unit tests for the ANTI-RUBBER-STAMP control harness.
 *
 * These tests MOCK the judge with fixture-keyed canned JudgeResults so they assert the
 * HARNESS LOGIC — per-fixture expected-vs-actual checks, the omission recall ceiling,
 * the cross-version verdict (v2 fixes paraphrase AND still catches genuine losses), and
 * the report rendering — is correct. NO network, NO real LLM. The REAL gpt-4.1 behaviour
 * on these same fixtures is the operator's separate (paid) step via the harness main().
 *
 * The critical assertions here are the NEGATIVE ones: a RUBBER-STAMP judge (one that
 * scores every fixture as perfect substance) MUST be REJECTED by computeVerdict. That is
 * the whole point of the deliverable — proving the harness would catch a lenient v2.
 */

import { describe, expect, it } from "vitest";
import {
	CONTROL_FIXTURES,
	type ControlFixture,
	type JudgeRunner,
	RECALL_SLACK,
	computeVerdict,
	evalFixture,
	expectedOmissionRecall,
	renderControlReport,
	runControls,
} from "../judge-controls.js";
import type { JudgeResult, JudgeVersion } from "../prose-judge.js";

// ---------------------------------------------------------------------------
// Helpers: synthesize a JudgeResult with the metric values a test wants.
// ---------------------------------------------------------------------------

function judge(opts: {
	recall?: number;
	qualifierFidelity?: number;
	addedUnsupported?: number;
}): JudgeResult {
	return {
		recall: opts.recall ?? 1,
		qualifierFidelity: opts.qualifierFidelity ?? 1,
		addedUnsupported: opts.addedUnsupported ?? 0,
		claims: [],
	};
}

// ---------------------------------------------------------------------------
// Fixture corpus shape — the deliverable's minimum counts.
// ---------------------------------------------------------------------------

describe("CONTROL_FIXTURES corpus", () => {
	const byKind = (k: string) => CONTROL_FIXTURES.filter((f) => f.kind === k);

	it("has >=3 paraphrase, >=3 omission, >=2 qualifier-drop, >=2 hallucination fixtures", () => {
		expect(byKind("paraphrase").length).toBeGreaterThanOrEqual(3);
		expect(byKind("omission").length).toBeGreaterThanOrEqual(3);
		expect(byKind("qualifier-drop").length).toBeGreaterThanOrEqual(2);
		expect(byKind("hallucination").length).toBeGreaterThanOrEqual(2);
	});

	it("every fixture carries the ground-truth field its kind requires", () => {
		for (const f of CONTROL_FIXTURES) {
			expect(f.reference.length).toBeGreaterThan(0);
			expect(f.candidate.length).toBeGreaterThan(0);
			if (f.kind === "paraphrase") expect(typeof f.minRecall).toBe("number");
			if (f.kind === "omission") {
				expect(typeof f.nClaims).toBe("number");
				expect(typeof f.nDropped).toBe("number");
			}
			if (f.kind === "qualifier-drop") expect(typeof f.maxQualifierFidelity).toBe("number");
			if (f.kind === "hallucination") expect(typeof f.minAddedUnsupported).toBe("number");
		}
	});
});

// ---------------------------------------------------------------------------
// expectedOmissionRecall — (N−K)/N
// ---------------------------------------------------------------------------

describe("expectedOmissionRecall", () => {
	it("computes (N−K)/N", () => {
		expect(expectedOmissionRecall(4, 2)).toBeCloseTo(0.5, 10);
		expect(expectedOmissionRecall(3, 1)).toBeCloseTo(2 / 3, 10);
		expect(expectedOmissionRecall(4, 3)).toBeCloseTo(0.25, 10);
	});
	it("throws on bad N/K", () => {
		expect(() => expectedOmissionRecall(0, 0)).toThrow();
		expect(() => expectedOmissionRecall(3, 4)).toThrow();
		expect(() => expectedOmissionRecall(3, -1)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// evalFixture — per-fixture expected-vs-actual + holds, per kind.
// ---------------------------------------------------------------------------

describe("evalFixture", () => {
	const para: ControlFixture = { id: "p", kind: "paraphrase", reference: "r", candidate: "c", minRecall: 0.9 };
	const omit: ControlFixture = {
		id: "o",
		kind: "omission",
		reference: "r",
		candidate: "c",
		nClaims: 4,
		nDropped: 2,
	};
	const qual: ControlFixture = {
		id: "q",
		kind: "qualifier-drop",
		reference: "r",
		candidate: "c",
		maxQualifierFidelity: 0.99,
	};
	const hall: ControlFixture = {
		id: "h",
		kind: "hallucination",
		reference: "r",
		candidate: "c",
		minAddedUnsupported: 1,
	};

	it("paraphrase HOLDS when recall clears the floor", () => {
		expect(evalFixture(para, judge({ recall: 0.95 })).holds).toBe(true);
		expect(evalFixture(para, judge({ recall: 0.9 })).holds).toBe(true);
		expect(evalFixture(para, judge({ recall: 0.8 })).holds).toBe(false);
	});

	it("omission HOLDS only when recall stays under (N−K)/N + slack (catches the drop)", () => {
		// (4−2)/4 = 0.5; ceiling = 0.5 + 0.1 = 0.6
		expect(evalFixture(omit, judge({ recall: 0.5 })).holds).toBe(true);
		expect(evalFixture(omit, judge({ recall: 0.6 })).holds).toBe(true); // exactly the ceiling
		// a rubber stamp that credits the dropped claims (recall ~1) FAILS the control
		expect(evalFixture(omit, judge({ recall: 1 })).holds).toBe(false);
		expect(evalFixture(omit, judge({ recall: 0.61 })).holds).toBe(false);
	});

	it("omission ceiling uses RECALL_SLACK exactly", () => {
		const ev = evalFixture(omit, judge({ recall: 0.5 + RECALL_SLACK }));
		expect(ev.holds).toBe(true);
		expect(evalFixture(omit, judge({ recall: 0.5 + RECALL_SLACK + 0.001 })).holds).toBe(false);
	});

	it("qualifier-drop HOLDS only when qualifierFidelity registers the loss (< 1)", () => {
		expect(evalFixture(qual, judge({ qualifierFidelity: 0.5 })).holds).toBe(true);
		expect(evalFixture(qual, judge({ qualifierFidelity: 0 })).holds).toBe(true);
		// a rubber stamp that keeps qualifierFidelity at 1.0 FAILS the control
		expect(evalFixture(qual, judge({ qualifierFidelity: 1 })).holds).toBe(false);
	});

	it("hallucination HOLDS only when addedUnsupported flags the invented claim", () => {
		expect(evalFixture(hall, judge({ addedUnsupported: 1 })).holds).toBe(true);
		expect(evalFixture(hall, judge({ addedUnsupported: 3 })).holds).toBe(true);
		// a rubber stamp that flags nothing FAILS the control
		expect(evalFixture(hall, judge({ addedUnsupported: 0 })).holds).toBe(false);
	});

	it("throws when a fixture is missing the field its kind requires", () => {
		expect(() => evalFixture({ ...para, minRecall: undefined }, judge({}))).toThrow(/minRecall/);
		expect(() => evalFixture({ ...omit, nDropped: undefined }, judge({}))).toThrow(/nClaims \+ nDropped/);
		expect(() => evalFixture({ ...qual, maxQualifierFidelity: undefined }, judge({}))).toThrow(/maxQualifierFidelity/);
		expect(() => evalFixture({ ...hall, minAddedUnsupported: undefined }, judge({}))).toThrow(/minAddedUnsupported/);
	});
});

// ---------------------------------------------------------------------------
// Mocked judge runners modelling distinct v1/v2 behaviours.
// ---------------------------------------------------------------------------

const FIXTURES: ControlFixture[] = [
	{ id: "para1", kind: "paraphrase", reference: "r", candidate: "c", minRecall: 0.9 },
	{ id: "para2", kind: "paraphrase", reference: "r", candidate: "c", minRecall: 0.9 },
	{ id: "para3", kind: "paraphrase", reference: "r", candidate: "c", minRecall: 0.9 },
	{ id: "omit1", kind: "omission", reference: "r", candidate: "c", nClaims: 4, nDropped: 2 },
	{ id: "omit2", kind: "omission", reference: "r", candidate: "c", nClaims: 4, nDropped: 3 },
	{ id: "qual1", kind: "qualifier-drop", reference: "r", candidate: "c", maxQualifierFidelity: 0.99 },
	{ id: "hall1", kind: "hallucination", reference: "r", candidate: "c", minAddedUnsupported: 1 },
];

/**
 * The GOOD v2 judge: semantic — recovers paraphrase recall (1.0), but STILL catches
 * genuine losses (omission recall ~ (N−K)/N, dropped qualifier, flagged hallucination).
 * v1 here UNDER-counts paraphrase (0.6) — the bug v2 fixes — and also catches losses.
 */
const goodRunner: JudgeRunner = async (fx, version: JudgeVersion) => {
	const v2 = version === "v2";
	switch (fx.kind) {
		case "paraphrase":
			return judge({ recall: v2 ? 1.0 : 0.6 }); // v2 fixes; v1 under-counts
		case "omission":
			return judge({ recall: expectedOmissionRecall(fx.nClaims as number, fx.nDropped as number) });
		case "qualifier-drop":
			return judge({ qualifierFidelity: 0.5 });
		case "hallucination":
			return judge({ addedUnsupported: 1 });
	}
};

/**
 * The RUBBER-STAMP v2 judge: credits EVERYTHING as perfect substance — recall 1,
 * qualifierFidelity 1, addedUnsupported 0 — regardless of genuine loss. v1 same as the
 * good runner (under-counts paraphrase, catches losses). computeVerdict MUST reject this.
 */
const rubberStampRunner: JudgeRunner = async (fx, version: JudgeVersion) => {
	if (version === "v2") return judge({ recall: 1, qualifierFidelity: 1, addedUnsupported: 0 });
	// v1 leg identical to the good runner
	return goodRunner(fx, version);
};

// ---------------------------------------------------------------------------
// runControls — drives every fixture through a mocked judge.
// ---------------------------------------------------------------------------

describe("runControls", () => {
	it("evaluates every fixture and records paraphrase recalls", async () => {
		const run = await runControls("v2", goodRunner, FIXTURES);
		expect(run.version).toBe("v2");
		expect(run.evals).toHaveLength(FIXTURES.length);
		expect(Object.keys(run.paraphraseRecall).sort()).toEqual(["para1", "para2", "para3"]);
		expect(run.paraphraseRecall.para1).toBe(1.0);
	});
});

// ---------------------------------------------------------------------------
// computeVerdict — the accept/reject gate. THE anti-rubber-stamp assertions.
// ---------------------------------------------------------------------------

describe("computeVerdict", () => {
	it("ACCEPTS a good v2: fixes paraphrase (recall up vs v1) AND still catches losses", async () => {
		const v1 = await runControls("v1", goodRunner, FIXTURES);
		const v2 = await runControls("v2", goodRunner, FIXTURES);
		const verdict = computeVerdict(v1, v2);
		expect(verdict.paraphraseFixed).toBe(true);
		expect(verdict.stillCatchesOmissions).toBe(true);
		expect(verdict.accepted).toBe(true);
	});

	it("REJECTS a RUBBER-STAMP v2 even though it 'passes' paraphrase (anti-gaming proof)", async () => {
		const v1 = await runControls("v1", rubberStampRunner, FIXTURES);
		const v2 = await runControls("v2", rubberStampRunner, FIXTURES);
		const verdict = computeVerdict(v1, v2);
		// it DID clear paraphrase (recall 1 > v1 0.6) ...
		expect(verdict.paraphraseFixed).toBe(true);
		// ... but it FAILED to catch omissions/qualifiers/hallucinations → REJECTED
		expect(verdict.stillCatchesOmissions).toBe(false);
		expect(verdict.accepted).toBe(false);
		expect(verdict.reasons.join("\n")).toMatch(/rubber-stamping a genuine omission/);
	});

	it("REJECTS a v2 that does NOT beat v1 on paraphrase (no improvement → buys nothing)", async () => {
		// v2 leg returns the SAME paraphrase recall as v1 (no improvement) but catches losses.
		const flatRunner: JudgeRunner = async (fx, _v) => {
			switch (fx.kind) {
				case "paraphrase":
					return judge({ recall: 0.95 }); // identical in v1 and v2 → not strictly greater
				case "omission":
					return judge({ recall: expectedOmissionRecall(fx.nClaims as number, fx.nDropped as number) });
				case "qualifier-drop":
					return judge({ qualifierFidelity: 0.5 });
				case "hallucination":
					return judge({ addedUnsupported: 1 });
			}
		};
		const v1 = await runControls("v1", flatRunner, FIXTURES);
		const v2 = await runControls("v2", flatRunner, FIXTURES);
		const verdict = computeVerdict(v1, v2);
		expect(verdict.paraphraseFixed).toBe(false);
		expect(verdict.stillCatchesOmissions).toBe(true);
		expect(verdict.accepted).toBe(false);
		expect(verdict.reasons.join("\n")).toMatch(/does NOT beat v1 on paraphrase/);
	});

	it("REJECTS when v2 fails the paraphrase floor outright", async () => {
		const lowParaRunner: JudgeRunner = async (fx, _v) => {
			switch (fx.kind) {
				case "paraphrase":
					return judge({ recall: 0.4 }); // below 0.9 floor
				case "omission":
					return judge({ recall: expectedOmissionRecall(fx.nClaims as number, fx.nDropped as number) });
				case "qualifier-drop":
					return judge({ qualifierFidelity: 0.5 });
				case "hallucination":
					return judge({ addedUnsupported: 1 });
			}
		};
		const v1 = await runControls("v1", lowParaRunner, FIXTURES);
		const v2 = await runControls("v2", lowParaRunner, FIXTURES);
		const verdict = computeVerdict(v1, v2);
		expect(verdict.paraphraseFixed).toBe(false);
		expect(verdict.accepted).toBe(false);
		expect(verdict.reasons.join("\n")).toMatch(/fails paraphrase floor/);
	});
});

// ---------------------------------------------------------------------------
// renderControlReport — the per-fixture table + verdict block.
// ---------------------------------------------------------------------------

describe("renderControlReport", () => {
	it("renders an expected-vs-actual row per fixture and an ACCEPTED verdict", async () => {
		const v1 = await runControls("v1", goodRunner, FIXTURES);
		const v2 = await runControls("v2", goodRunner, FIXTURES);
		const md = renderControlReport(v1, v2, computeVerdict(v1, v2));
		expect(md).toContain("anti-rubber-stamp controls");
		for (const f of FIXTURES) expect(md).toContain(f.id);
		expect(md).toContain("v2 ACCEPTED");
		// shows both the v1 and the v2 actual for a paraphrase fixture
		expect(md).toMatch(/para1 \| paraphrase \| recall .*\| 0.600 \| 1.000 \| yes/);
	});

	it("renders a REJECTED verdict for a rubber-stamp v2", async () => {
		const v1 = await runControls("v1", rubberStampRunner, FIXTURES);
		const v2 = await runControls("v2", rubberStampRunner, FIXTURES);
		const md = renderControlReport(v1, v2, computeVerdict(v1, v2));
		expect(md).toContain("v2 REJECTED");
	});
});
