/**
 * prose-gold.test.ts — unit tests for the GOLD-reference module. Covers the PURE
 * pieces (buildGoldPrompt completeness contract, the model-identity guard, the
 * gold-file (de)serialization round-trip, gold-completeness validation) plus the
 * freeze/reuse semantics of loadOrGenerateGold with a MOCKED LLM and an in-memory
 * store. NO network, NO real generation, NO disk.
 */

import { describe, expect, it, vi } from "vitest";
import {
	GOLD_COMPLETENESS_FLOOR,
	GOLD_MODEL,
	GOLD_PROMPT_VERSION,
	type GoldFile,
	type GoldStore,
	assertGoldModelDiffers,
	buildGoldPrompt,
	buildGoldValidation,
	generateGold,
	loadOrGenerateGold,
	parseGoldFile,
	serializeGoldFile,
	summarizeGoldValidation,
} from "../prose-gold.js";

// ---------------------------------------------------------------------------
// Frozen identity — an accidental re-base during tuning trips here.
// ---------------------------------------------------------------------------

describe("frozen gold identity", () => {
	it("GOLD_MODEL is gpt-4.1 and the prompt version is v1", () => {
		expect(GOLD_MODEL).toBe("gpt-4.1");
		expect(GOLD_PROMPT_VERSION).toBe("prose-gold-v1");
	});
});

// ---------------------------------------------------------------------------
// buildGoldPrompt — completeness-first contract (NOT lossy terseness)
// ---------------------------------------------------------------------------

describe("buildGoldPrompt", () => {
	it("embeds the question and prioritizes COMPLETENESS over brevity", () => {
		const p = buildGoldPrompt("What is recall?");
		expect(p).toContain("What is recall?");
		// completeness-first language present
		expect(p).toMatch(/EVERY substantive point/);
		expect(p).toMatch(/condition, qualifier, caveat/i);
		expect(p).toMatch(/Completeness is the priority/i);
		// it must NOT instruct terseness in a way that drops content
		expect(p).toMatch(/Do NOT compress at the cost of any fact/i);
		// only filler is to be removed
		expect(p).toMatch(/Omit ONLY filler/i);
	});
});

// ---------------------------------------------------------------------------
// assertGoldModelDiffers — anti-self-grading guard (model id, not provider)
// ---------------------------------------------------------------------------

describe("assertGoldModelDiffers", () => {
	it("throws when the gold model equals the model-under-test", () => {
		expect(() => assertGoldModelDiffers("gpt-4o-mini", "gpt-4o-mini")).toThrow(/must DIFFER/);
	});
	it("passes when they differ", () => {
		expect(() => assertGoldModelDiffers("gpt-4.1", "gpt-4o-mini")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// serializeGoldFile / parseGoldFile — round-trip
// ---------------------------------------------------------------------------

describe("gold file serialize/parse round-trip", () => {
	const g: GoldFile = {
		id: "factual-recall-def",
		goldModel: "gpt-4.1",
		promptVersion: "prose-gold-v1",
		question: "In information retrieval, what does 'recall' mean?\nGive the formula.",
		gold: "Recall = TP / (TP + FN).\nFraction of relevant items retrieved.",
	};

	it("round-trips all fields including a multi-line question and body", () => {
		const parsed = parseGoldFile(serializeGoldFile(g));
		expect(parsed).toEqual(g);
	});

	it("encodes the question so a multi-line question cannot corrupt the header", () => {
		const ser = serializeGoldFile(g);
		// header is single-line key:value pairs; the raw multi-line question must NOT
		// leak into the header region (it is base64-encoded).
		const header = ser.split("\n---\n")[0];
		expect(header).not.toContain("Give the formula.");
		expect(header).toContain("questionB64:");
	});

	it("throws on a missing header fence", () => {
		expect(() => parseGoldFile("no fence here\nbody")).toThrow(/header fence/);
	});

	it("throws on a missing required header field", () => {
		const broken = ["---", "id: x", "goldModel: gpt-4.1", "promptVersion: v1", "---", "body"].join("\n");
		expect(() => parseGoldFile(broken)).toThrow(/questionB64/);
	});
});

// ---------------------------------------------------------------------------
// generateGold — injected LLM, guard runs first, empty rejected
// ---------------------------------------------------------------------------

describe("generateGold (mocked one-shot)", () => {
	const opts = { goldModel: "gpt-4.1", modelUnderTest: "gpt-4o-mini" };

	it("builds the completeness prompt and returns the trimmed gold body", async () => {
		const runOneShot = vi.fn(async () => "  the complete gold answer  ");
		const gold = await generateGold({ id: "p", question: "Q?" }, runOneShot, opts);
		expect(gold).toBe("the complete gold answer");
		// the injected call saw the completeness rubric + the question
		const userArg = runOneShot.mock.calls[0][1];
		expect(userArg).toContain("Q?");
		expect(userArg).toMatch(/EVERY substantive point/);
	});

	it("runs the model-identity guard BEFORE calling the LLM", async () => {
		const runOneShot = vi.fn(async () => "x");
		await expect(
			generateGold({ id: "p", question: "Q?" }, runOneShot, { goldModel: "same", modelUnderTest: "same" }),
		).rejects.toThrow(/must DIFFER/);
		expect(runOneShot).not.toHaveBeenCalled();
	});

	it("throws on an empty gold (an empty reference would make every recall 1)", async () => {
		const runOneShot = vi.fn(async () => "   ");
		await expect(generateGold({ id: "p", question: "Q?" }, runOneShot, opts)).rejects.toThrow(/empty/);
	});
});

// ---------------------------------------------------------------------------
// loadOrGenerateGold — FREEZE-OR-REUSE
// ---------------------------------------------------------------------------

/** Minimal in-memory GoldStore for the freeze/reuse tests. */
function memStore(initial: Record<string, string> = {}): GoldStore & { files: Map<string, string> } {
	const files = new Map<string, string>(Object.entries(initial));
	return {
		files,
		read: (id) => files.get(id) ?? null,
		write: (id, contents) => {
			files.set(id, contents);
		},
	};
}

describe("loadOrGenerateGold (freeze-or-reuse)", () => {
	const opts = { goldModel: "gpt-4.1", modelUnderTest: "gpt-4o-mini" };

	it("GENERATES + persists when no frozen gold exists", async () => {
		const store = memStore();
		const runOneShot = vi.fn(async () => "fresh gold");
		const resolved = await loadOrGenerateGold({ id: "p1", question: "Q1" }, store, runOneShot, opts);
		expect(resolved.reused).toBe(false);
		expect(resolved.gold).toBe("fresh gold");
		expect(runOneShot).toHaveBeenCalledOnce();
		// persisted for next time
		expect(store.files.has("p1")).toBe(true);
		expect(parseGoldFile(store.files.get("p1") as string).gold).toBe("fresh gold");
	});

	it("REUSES an existing frozen gold and NEVER regenerates it", async () => {
		const frozen = serializeGoldFile({
			id: "p1",
			goldModel: "gpt-4.1",
			promptVersion: "prose-gold-v1",
			question: "Q1",
			gold: "the frozen gold",
		});
		const store = memStore({ p1: frozen });
		const runOneShot = vi.fn(async () => "DIFFERENT regenerated text");
		const resolved = await loadOrGenerateGold({ id: "p1", question: "Q1" }, store, runOneShot, opts);
		expect(resolved.reused).toBe(true);
		expect(resolved.gold).toBe("the frozen gold");
		// the frozen-before-measuring guarantee: the LLM is NOT called for an existing gold
		expect(runOneShot).not.toHaveBeenCalled();
	});

	it("throws on corpus drift (frozen gold's question != current question)", async () => {
		const frozen = serializeGoldFile({
			id: "p1",
			goldModel: "gpt-4.1",
			promptVersion: "prose-gold-v1",
			question: "OLD question",
			gold: "g",
		});
		const store = memStore({ p1: frozen });
		const runOneShot = vi.fn(async () => "x");
		await expect(
			loadOrGenerateGold({ id: "p1", question: "NEW question" }, store, runOneShot, opts),
		).rejects.toThrow(/corpus drift/);
		expect(runOneShot).not.toHaveBeenCalled();
	});

	it("enforces the model-identity guard when generating a missing gold", async () => {
		const store = memStore();
		const runOneShot = vi.fn(async () => "x");
		await expect(
			loadOrGenerateGold({ id: "p1", question: "Q1" }, store, runOneShot, {
				goldModel: "clash",
				modelUnderTest: "clash",
			}),
		).rejects.toThrow(/must DIFFER/);
		expect(runOneShot).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// gold-completeness validation — the gold must NOT be lossy
// ---------------------------------------------------------------------------

describe("buildGoldValidation / summarizeGoldValidation", () => {
	it("does NOT flag a faithful gold (recall_off_in_gold high)", () => {
		const v = buildGoldValidation("p", 0.95);
		expect(v.flagged).toBe(false);
		expect(v.recallOffInGold).toBe(0.95);
	});

	it("FLAGS a lossy gold below the 0.85 completeness floor", () => {
		expect(buildGoldValidation("p", 0.8).flagged).toBe(true);
		// boundary: exactly the floor is NOT flagged (>= floor is acceptable)
		expect(buildGoldValidation("p", GOLD_COMPLETENESS_FLOOR).flagged).toBe(false);
		expect(buildGoldValidation("p", GOLD_COMPLETENESS_FLOOR - 0.001).flagged).toBe(true);
	});

	it("summarizes flagged count + anySuspect", () => {
		const s = summarizeGoldValidation([
			buildGoldValidation("a", 0.95),
			buildGoldValidation("b", 0.7),
			buildGoldValidation("c", 0.99),
		]);
		expect(s.nFlagged).toBe(1);
		expect(s.nTotal).toBe(3);
		expect(s.anySuspect).toBe(true);
	});

	it("anySuspect is false when no gold is flagged", () => {
		const s = summarizeGoldValidation([buildGoldValidation("a", 0.95), buildGoldValidation("b", 0.9)]);
		expect(s.anySuspect).toBe(false);
		expect(s.nFlagged).toBe(0);
	});
});
