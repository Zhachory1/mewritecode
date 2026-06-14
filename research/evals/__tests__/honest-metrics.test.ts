import { describe, expect, it } from "vitest";
import {
	computeCost,
	costDeltaVsOff,
	costPerResolved,
	meanSdMedian,
	type PricingRow,
	parseCodexUsage,
	parseFailureRate,
	passRate,
	passRateDeltaVsOff,
	type Run,
	totalProcessed,
	type Usage,
} from "../honest-metrics.js";

// ---------------------------------------------------------------------------
// Deterministic seeded PRNG (mulberry32) — mirrors the production helper so
// tests can assert reproducibility without depending on internal export.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TABLE: Record<string, PricingRow> = {
	// $/Mtok
	"gpt-5.4": { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25 },
	cheap: { input: 0.5, output: 1, cacheRead: 0.05, cacheWrite: 0.5 },
};

const U = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage => ({
	input,
	output,
	cacheRead,
	cacheWrite,
});

function run(partial: Partial<Run> & Pick<Run, "level" | "task" | "seed" | "resolved">): Run {
	return {
		model: "gpt-5.4",
		usage: partial.usage === undefined ? U(1_000_000, 1_000_000) : partial.usage,
		parseStatus: "ok",
		...partial,
	} as Run;
}

describe("totalProcessed", () => {
	it("sums all four usage fields", () => {
		expect(totalProcessed(U(10, 20, 30, 40))).toBe(100);
	});
});

describe("computeCost", () => {
	it("prices each usage class at the per-Mtok rate", () => {
		// 1M input @ $1 + 1M output @ $4 + 1M cacheRead @ $0.1 + 1M cacheWrite @ $1.25
		const cost = computeCost(U(1_000_000, 1_000_000, 1_000_000, 1_000_000), TABLE, "gpt-5.4");
		expect(cost).toBeCloseTo(1 + 4 + 0.1 + 1.25, 10);
	});

	it("scales linearly with token counts", () => {
		const cost = computeCost(U(2_000_000, 0, 0, 0), TABLE, "gpt-5.4");
		expect(cost).toBeCloseTo(2, 10);
	});

	it("returns null for an unpriced model", () => {
		expect(computeCost(U(1_000_000, 0, 0, 0), TABLE, "unknown-model")).toBeNull();
	});
});

describe("costPerResolved", () => {
	it("uses two-stage equal-task-weight median; a task resolving 5x must not dominate", () => {
		// Task A: resolves 5 times, each cheap (1M input only => $1). Per-task median = $1.
		// Task B: resolves once, expensive (5M input => $5). Per-task median = $5.
		// Stage-2 median over tasks {1, 5} = 3.
		// If it were a flat seed-weighted mean/median, the 5 cheap A seeds would dominate.
		const runs: Run[] = [
			...[0, 1, 2, 3, 4].map((s) =>
				run({ level: "ultra", task: "A", seed: s, resolved: true, usage: U(1_000_000, 0) }),
			),
			run({ level: "ultra", task: "B", seed: 0, resolved: true, usage: U(5_000_000, 0) }),
		];
		const out = costPerResolved(runs, TABLE);
		expect(out).toHaveLength(1);
		expect(out[0].level).toBe("ultra");
		expect(out[0].model).toBe("gpt-5.4");
		expect(out[0].nTasks).toBe(2);
		expect(out[0].medianCost).toBeCloseTo(3, 10);
	});

	it("excludes unresolved runs from the cost", () => {
		// Task A: one resolved cheap ($1), one unresolved expensive ($100) — ignored.
		// Task B: one resolved ($3).
		const runs: Run[] = [
			run({ level: "ultra", task: "A", seed: 0, resolved: true, usage: U(1_000_000, 0) }),
			run({ level: "ultra", task: "A", seed: 1, resolved: false, usage: U(100_000_000, 0) }),
			run({ level: "ultra", task: "B", seed: 0, resolved: true, usage: U(3_000_000, 0) }),
		];
		const out = costPerResolved(runs, TABLE);
		// per-task medians: A=1, B=3; median over tasks = 2.
		expect(out[0].medianCost).toBeCloseTo(2, 10);
		expect(out[0].nTasks).toBe(2);
	});

	it("groups by (level, model)", () => {
		const runs: Run[] = [
			run({ level: "off", task: "A", seed: 0, resolved: true, usage: U(1_000_000, 0) }),
			run({ level: "ultra", task: "A", seed: 0, resolved: true, usage: U(2_000_000, 0) }),
		];
		const out = costPerResolved(runs, TABLE);
		expect(out).toHaveLength(2);
		const byLevel = Object.fromEntries(out.map((r) => [r.level, r.medianCost]));
		expect(byLevel.off).toBeCloseTo(1, 10);
		expect(byLevel.ultra).toBeCloseTo(2, 10);
	});
});

describe("passRate", () => {
	it("computes resolved/attempted per (level, model)", () => {
		const runs: Run[] = [
			run({ level: "off", task: "A", seed: 0, resolved: true }),
			run({ level: "off", task: "B", seed: 0, resolved: false }),
			run({ level: "off", task: "C", seed: 0, resolved: true }),
			run({ level: "ultra", task: "A", seed: 0, resolved: true }),
		];
		const out = passRate(runs);
		const off = out.find((r) => r.level === "off");
		expect(off?.rate).toBeCloseTo(2 / 3, 10);
		expect(off?.n).toBe(3);
		const ultra = out.find((r) => r.level === "ultra");
		expect(ultra?.rate).toBe(1);
		expect(ultra?.n).toBe(1);
	});
});

describe("costDeltaVsOff", () => {
	function pair(task: string, seed: number, offCost: number, lvlCost: number): Run[] {
		// usage with only input tokens => cost == input/1e6 at $1/Mtok.
		return [
			run({ level: "off", task, seed, resolved: true, usage: U(offCost * 1_000_000, 0) }),
			run({ level: "ultra", task, seed, resolved: true, usage: U(lvlCost * 1_000_000, 0) }),
		];
	}

	it("nPairs<10 → ci95 null + insufficient_pairs note", () => {
		const runs: Run[] = [];
		for (let i = 0; i < 5; i++) runs.push(...pair(`t${i}`, 0, 2, 1));
		const out = costDeltaVsOff(runs, TABLE, mulberry32(1));
		const ultra = out.find((r) => r.level === "ultra");
		expect(ultra).toBeDefined();
		expect(ultra?.nPairs).toBe(5);
		expect(ultra?.ci95).toBeNull();
		expect(ultra?.note).toBe("insufficient_pairs");
		// median ratio of cost_level/cost_off = 1/2 = 0.5
		expect(ultra?.medianRatio).toBeCloseTo(0.5, 10);
	});

	it("with >=10 matched pairs, CI brackets the median ratio and is deterministic", () => {
		const runs: Run[] = [];
		for (let i = 0; i < 12; i++) runs.push(...pair(`t${i}`, 0, 2, 1));
		const a = costDeltaVsOff(runs, TABLE, mulberry32(42));
		const b = costDeltaVsOff(runs, TABLE, mulberry32(42));
		const ua = a.find((r) => r.level === "ultra");
		const ub = b.find((r) => r.level === "ultra");
		expect(ua?.nPairs).toBe(12);
		expect(ua?.medianRatio).toBeCloseTo(0.5, 10);
		expect(ua?.ci95).not.toBeNull();
		// deterministic under the same seed
		expect(ua?.ci95).toEqual(ub?.ci95);
		// CI brackets the median ratio
		const [lo, hi] = ua?.ci95 as [number, number];
		expect(lo).toBeLessThanOrEqual(ua?.medianRatio as number);
		expect(hi).toBeGreaterThanOrEqual(ua?.medianRatio as number);
	});

	it("flags powerWarning when CI width ratio exceeds 3x", () => {
		// Wildly dispersed ratios so the exp-CI spans >3x.
		const ratios = [0.1, 0.2, 0.5, 1, 2, 5, 10, 0.3, 3, 0.15, 8, 0.05];
		const runs: Run[] = ratios.flatMap((r, i) => pair(`t${i}`, 0, 1, r));
		const out = costDeltaVsOff(runs, TABLE, mulberry32(7));
		const ultra = out.find((r) => r.level === "ultra");
		expect(ultra?.ci95).not.toBeNull();
		const [lo, hi] = ultra?.ci95 as [number, number];
		expect(hi / lo).toBeGreaterThan(3);
		expect(ultra?.powerWarning).toBe(true);
	});

	it("flags low pairedRate when fewer than half of tasks are matched-resolved", () => {
		const runs: Run[] = [];
		// 12 matched pairs (both resolved)
		for (let i = 0; i < 12; i++) runs.push(...pair(`m${i}`, 0, 2, 1));
		// 20 tasks where off resolved but ultra did not → unmatched
		for (let i = 0; i < 20; i++) {
			runs.push(run({ level: "off", task: `u${i}`, seed: 0, resolved: true, usage: U(1_000_000, 0) }));
			runs.push(run({ level: "ultra", task: `u${i}`, seed: 0, resolved: false, usage: U(1_000_000, 0) }));
		}
		const out = costDeltaVsOff(runs, TABLE, mulberry32(3));
		const ultra = out.find((r) => r.level === "ultra");
		// pairedRate = 12 / 32 = 0.375 < 0.5
		expect(ultra?.pairedRate).toBeCloseTo(12 / 32, 10);
		expect(ultra?.note).toContain("low_paired_rate");
	});

	it("only pairs rows where BOTH off and level resolved at the same (task, seed)", () => {
		const runs: Run[] = [
			// matched
			...pair("a", 0, 2, 1),
			// off resolved, ultra not → excluded
			run({ level: "off", task: "b", seed: 0, resolved: true, usage: U(2_000_000, 0) }),
			run({ level: "ultra", task: "b", seed: 0, resolved: false, usage: U(1_000_000, 0) }),
			// different seed, no off counterpart → excluded
			run({ level: "ultra", task: "a", seed: 9, resolved: true, usage: U(1_000_000, 0) }),
		];
		const out = costDeltaVsOff(runs, TABLE, mulberry32(1));
		const ultra = out.find((r) => r.level === "ultra");
		expect(ultra?.nPairs).toBe(1);
	});
});

describe("passRateDeltaVsOff", () => {
	it("returns delta + CI from the (task,seed) resolved matrix (hand-checked discordant pairs)", () => {
		// Build a matrix where off and ultra disagree.
		// Discordant: off resolved & ultra not (b=count where off=1,level=0),
		//             ultra resolved & off not (c=count where off=0,level=1).
		// delta = passRate(level) - passRate(off).
		const runs: Run[] = [];
		// 5 concordant resolved (both 1)
		for (let i = 0; i < 5; i++) runs.push(...both(`c${i}`, true, true));
		// 4 discordant: off resolved, ultra not
		for (let i = 0; i < 4; i++) runs.push(...both(`d${i}`, true, false));
		// 1 discordant: ultra resolved, off not
		runs.push(...both("e0", false, true));
		const out = passRateDeltaVsOff(runs);
		const ultra = out.find((r) => r.level === "ultra");
		expect(ultra).toBeDefined();
		// off pass = (5+4)/10 = 0.9 ; ultra pass = (5+1)/10 = 0.6 ; delta = -0.3
		expect(ultra?.delta).toBeCloseTo(-0.3, 10);
		expect(ultra?.ci95).toHaveLength(2);
		const [lo, hi] = ultra?.ci95 as [number, number];
		expect(lo).toBeLessThanOrEqual(ultra?.delta as number);
		expect(hi).toBeGreaterThanOrEqual(ultra?.delta as number);
		expect(ultra?.nPairs).toBe(10);
	});

	it("dedups duplicate (task,seed) runs — nPairs counts unique pairs, not runs", () => {
		const runs: Run[] = [
			run({ level: "off", task: "a", seed: 0, resolved: true }),
			run({ level: "ultra", task: "a", seed: 0, resolved: true }),
			// accidental duplicate (task,seed) at the level — must NOT inflate nPairs
			run({ level: "ultra", task: "a", seed: 0, resolved: false }),
		];
		const ultra = passRateDeltaVsOff(runs).find((r) => r.level === "ultra");
		expect(ultra?.nPairs).toBe(1);
	});

	function both(task: string, off: boolean, lvl: boolean): Run[] {
		return [
			run({ level: "off", task, seed: 0, resolved: off }),
			run({ level: "ultra", task, seed: 0, resolved: lvl }),
		];
	}
});

describe("parseFailureRate", () => {
	it("computes fraction of runs at a level with parseStatus failed", () => {
		const runs: Run[] = [
			run({ level: "codex", task: "a", seed: 0, resolved: false, parseStatus: "failed", usage: null }),
			run({ level: "codex", task: "b", seed: 0, resolved: true, parseStatus: "ok" }),
			run({ level: "codex", task: "c", seed: 0, resolved: false, parseStatus: "failed", usage: null }),
			run({ level: "codex", task: "d", seed: 0, resolved: true, parseStatus: "ok" }),
		];
		expect(parseFailureRate(runs, "codex")).toBeCloseTo(0.5, 10);
	});

	it("returns 0 when level has no runs", () => {
		expect(parseFailureRate([], "codex")).toBe(0);
	});
});

describe("meanSdMedian", () => {
	it("hand-checked stats", () => {
		const out = meanSdMedian([2, 4, 4, 4, 5, 5, 7, 9]);
		expect(out.n).toBe(8);
		expect(out.mean).toBeCloseTo(5, 10);
		expect(out.median).toBeCloseTo(4.5, 10);
		// population sd of this classic dataset = 2
		expect(out.sd).toBeCloseTo(2, 10);
	});

	it("median of odd-length set", () => {
		expect(meanSdMedian([3, 1, 2]).median).toBe(2);
	});

	it("empty set → zeros", () => {
		const out = meanSdMedian([]);
		expect(out.n).toBe(0);
		expect(out.median).toBe(0);
		expect(out.mean).toBe(0);
		expect(out.sd).toBe(0);
	});
});

describe("parseCodexUsage (UNCONFIRMED path)", () => {
	it("parses Usage + model only, never cost", () => {
		const stdout = JSON.stringify({
			model: "gpt-5.4-codex",
			usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, cache_write_tokens: 5 },
		});
		const out = parseCodexUsage(stdout);
		expect(out.status).toBe("ok");
		expect(out.model).toBe("gpt-5.4-codex");
		expect(out.usage).toEqual({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5 });
		// no cost field exists on the return type — usage is tokens only
		expect(out).not.toHaveProperty("cost");
	});

	it("missing output → status failed, no fabrication", () => {
		const stdout = JSON.stringify({ model: "x", usage: { input_tokens: 100 } });
		const out = parseCodexUsage(stdout);
		expect(out.status).toBe("failed");
		expect(out.usage).toBeNull();
	});

	it("missing input → status failed", () => {
		const stdout = JSON.stringify({ model: "x", usage: { output_tokens: 50 } });
		const out = parseCodexUsage(stdout);
		expect(out.status).toBe("failed");
		expect(out.usage).toBeNull();
	});

	it("garbage → failed", () => {
		expect(parseCodexUsage("not json at all").status).toBe("failed");
		expect(parseCodexUsage("").status).toBe("failed");
		expect(parseCodexUsage("{}").status).toBe("failed");
	});
});
