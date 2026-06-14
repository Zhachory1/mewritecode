/**
 * run-cave-ablation.test.ts — unit tests for the PURE pieces of the ablation
 * orchestrator (#33): arg parsing, condition enumeration, the two relabel views
 * (prose-at-fixed-compression, compression-at-fixed-prose), per-condition stats,
 * effect computation, manifest assembly, buildConditionRuns, and CSV emission.
 *
 * NO subprocess, NO network, NO filesystem: trace/prediction data is injected as
 * fixtures via buildConditionRuns, exactly as the runner consumes them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mulberry32, type PricingRow, type Usage } from "../honest-metrics.js";
import {
	type AblationRun,
	assembleManifest,
	buildCompressionEffectBlocks,
	buildConditionRuns,
	buildProseEffectBlocks,
	compressionAtFixedProseView,
	compressionEffect,
	COMPRESSION_ON_LEVEL,
	type Condition,
	conditionRunId,
	type ConditionStat,
	type EffectEntry,
	enumerateConditions,
	HelpRequested,
	parseAblationArgs,
	parseResolvedFromLogs,
	perConditionStats,
	proseAtFixedCompressionView,
	proseEffect,
	runsToCsv,
} from "../run-cave-ablation.js";

const TABLE: Record<string, PricingRow> = {
	"gpt-5.4": { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25 },
};

const U = (input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage => ({
	input,
	output,
	cacheRead,
	cacheWrite,
});

function ar(p: Partial<AblationRun> & Pick<AblationRun, "prose" | "compression" | "task" | "resolved">): AblationRun {
	return {
		seed: 0,
		model: "gpt-5.4",
		usage: p.usage === undefined ? U(1_000_000) : p.usage,
		...p,
	} as AblationRun;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

describe("parseAblationArgs", () => {
	it("defaults: all 4 prose, compression on, seeds 1", () => {
		const c = parseAblationArgs([]);
		expect(c.prose).toEqual(["off", "lite", "full", "ultra"]);
		expect(c.compression).toEqual(["on"]);
		expect(c.seeds).toBe(1);
		expect(c.score).toBe(false);
		expect(c.dryRun).toBe(false);
		expect(c.provider).toBe("openai-codex");
		expect(c.model).toBe("gpt-5.4");
	});

	it("parses csv prose + compression and scalar flags", () => {
		const c = parseAblationArgs([
			"--prose",
			"off,ultra",
			"--compression",
			"on,off",
			"--seeds",
			"1",
			"--provider",
			"anthropic",
			"--model",
			"claude-x",
			"--limit",
			"7",
			"--cap",
			"2.5",
			"--score",
		]);
		expect(c.prose).toEqual(["off", "ultra"]);
		expect(c.compression).toEqual(["on", "off"]);
		expect(c.seeds).toBe(1);
		expect(c.provider).toBe("anthropic");
		expect(c.model).toBe("claude-x");
		expect(c.limit).toBe(7);
		expect(c.cap).toBe(2.5);
		expect(c.score).toBe(true);
	});

	it("rejects --seeds>1 (would fabricate statistical replicates; #33)", () => {
		expect(() => parseAblationArgs(["--seeds", "3"])).toThrow(/fabricate statistical replicates/);
		expect(() => parseAblationArgs(["--seeds", "2"])).toThrow(/sampling-seed control is not wired/);
		// --seeds 1 still works.
		expect(parseAblationArgs(["--seeds", "1"]).seeds).toBe(1);
	});

	it("--dry-run sets dryRun", () => {
		expect(parseAblationArgs(["--dry-run"]).dryRun).toBe(true);
	});

	it("rejects invalid prose / compression / seeds / limit / cap", () => {
		expect(() => parseAblationArgs(["--prose", "bogus"])).toThrow(/Invalid --prose/);
		expect(() => parseAblationArgs(["--compression", "maybe"])).toThrow(/Invalid --compression/);
		expect(() => parseAblationArgs(["--seeds", "0"])).toThrow(/Invalid --seeds/);
		expect(() => parseAblationArgs(["--limit", "-1"])).toThrow(/Invalid --limit/);
		expect(() => parseAblationArgs(["--cap", "0"])).toThrow(/Invalid --cap/);
		expect(() => parseAblationArgs(["--what"])).toThrow(/Unknown arg/);
	});

	it("--help throws HelpRequested", () => {
		expect(() => parseAblationArgs(["--help"])).toThrow(HelpRequested);
		expect(() => parseAblationArgs(["-h"])).toThrow(HelpRequested);
	});
});

// ---------------------------------------------------------------------------
// Condition enumeration
// ---------------------------------------------------------------------------

describe("enumerateConditions", () => {
	it("is the full prose × compression × seed cross product with stable slugs", () => {
		const conds = enumerateConditions({
			...parseAblationArgs([]),
			prose: ["off", "ultra"],
			compression: ["on", "off"],
			seeds: 2,
		});
		expect(conds).toHaveLength(2 * 2 * 2);
		expect(conds.map((c) => c.slug)).toEqual([
			"off_on_s0",
			"off_on_s1",
			"off_off_s0",
			"off_off_s1",
			"ultra_on_s0",
			"ultra_on_s1",
			"ultra_off_s0",
			"ultra_off_s1",
		]);
	});
});

// ---------------------------------------------------------------------------
// Relabel views — the 2-factor isolation
// ---------------------------------------------------------------------------

describe("proseAtFixedCompressionView", () => {
	it("keeps only the fixed compression and labels level by PROSE", () => {
		const runs: AblationRun[] = [
			ar({ prose: "off", compression: "on", task: "t1", resolved: true }),
			ar({ prose: "ultra", compression: "on", task: "t1", resolved: true }),
			ar({ prose: "off", compression: "off", task: "t1", resolved: true }), // dropped (wrong compression)
		];
		const view = proseAtFixedCompressionView(runs, "on");
		expect(view).toHaveLength(2);
		expect(view.map((r) => r.level).sort()).toEqual(["off", "ultra"]);
		expect(view.every((r) => r.parseStatus === "n/a")).toBe(true);
	});
});

describe("compressionAtFixedProseView", () => {
	it("keeps only the fixed prose and maps compression on→carrier-level, off→off", () => {
		const runs: AblationRun[] = [
			ar({ prose: "ultra", compression: "off", task: "t1", resolved: true }),
			ar({ prose: "ultra", compression: "on", task: "t1", resolved: true }),
			ar({ prose: "off", compression: "on", task: "t1", resolved: true }), // dropped (wrong prose)
		];
		const view = compressionAtFixedProseView(runs, "ultra");
		expect(view).toHaveLength(2);
		const offRun = view.find((r) => r.level === "off");
		const onRun = view.find((r) => r.level === COMPRESSION_ON_LEVEL);
		expect(offRun).toBeDefined();
		expect(onRun).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Per-condition stats
// ---------------------------------------------------------------------------

describe("perConditionStats", () => {
	it("computes passRate + medianCostPerResolved per (prose,compression)", () => {
		const runs: AblationRun[] = [
			ar({ prose: "ultra", compression: "on", task: "t1", resolved: true, usage: U(1_000_000) }),
			ar({ prose: "ultra", compression: "on", task: "t2", resolved: false, usage: U(1_000_000) }),
			ar({ prose: "off", compression: "off", task: "t1", resolved: true, usage: U(2_000_000) }),
		];
		const stats = perConditionStats(runs, TABLE);
		const ultraOn = stats.find((s) => s.prose === "ultra" && s.compression === "on");
		const offOff = stats.find((s) => s.prose === "off" && s.compression === "off");
		expect(ultraOn?.passRate).toBeCloseTo(0.5, 10);
		expect(ultraOn?.n).toBe(2);
		expect(ultraOn?.medianCostPerResolved).toBeCloseTo(1, 10); // 1M input @ $1
		expect(offOff?.passRate).toBeCloseTo(1, 10);
		expect(offOff?.medianCostPerResolved).toBeCloseTo(2, 10); // 2M input @ $1
	});
});

// ---------------------------------------------------------------------------
// Effects — isolate one factor, deterministic under seeded PRNG
// ---------------------------------------------------------------------------

describe("proseEffect (prose varies, compression fixed)", () => {
	it("ultra-vs-off at fixed compression yields a >1 cost ratio when ultra is pricier", () => {
		// 12 paired tasks so nPairs >= MIN_PAIRS (10); ultra costs 2x off, both resolved.
		const runs: AblationRun[] = [];
		for (let i = 0; i < 12; i++) {
			runs.push(ar({ prose: "off", compression: "on", task: `t${i}`, resolved: true, usage: U(1_000_000) }));
			runs.push(ar({ prose: "ultra", compression: "on", task: `t${i}`, resolved: true, usage: U(2_000_000) }));
		}
		const eff = proseEffect(runs, "on", TABLE, mulberry32(1));
		const ultra = eff.find((e) => e.level === "ultra");
		expect(ultra?.costMedianRatio).toBeCloseTo(2, 6);
		expect(ultra?.costNPairs).toBe(12);
		expect(ultra?.costCi95).not.toBeNull();
		// deterministic under the same seed
		const eff2 = proseEffect(runs, "on", TABLE, mulberry32(1));
		expect(eff2.find((e) => e.level === "ultra")?.costCi95).toEqual(ultra?.costCi95);
	});
});

describe("compressionEffect (compression varies, prose fixed)", () => {
	it("on-vs-off at fixed prose yields a <1 cost ratio when compression saves tokens", () => {
		// compression OFF (baseline) costs 2x; compression ON costs 1x => ratio 0.5.
		const runs: AblationRun[] = [];
		for (let i = 0; i < 12; i++) {
			runs.push(ar({ prose: "ultra", compression: "off", task: `t${i}`, resolved: true, usage: U(2_000_000) }));
			runs.push(ar({ prose: "ultra", compression: "on", task: `t${i}`, resolved: true, usage: U(1_000_000) }));
		}
		const eff = compressionEffect(runs, "ultra", TABLE, mulberry32(2));
		const on = eff.find((e) => e.level === COMPRESSION_ON_LEVEL);
		expect(on?.costMedianRatio).toBeCloseTo(0.5, 6);
		expect(on?.costNPairs).toBe(12);
	});

	it("passRate delta is captured per compression level", () => {
		const runs: AblationRun[] = [];
		for (let i = 0; i < 12; i++) {
			// off resolves all; on resolves all but one -> small negative delta
			runs.push(ar({ prose: "full", compression: "off", task: `t${i}`, resolved: true }));
			runs.push(ar({ prose: "full", compression: "on", task: `t${i}`, resolved: i !== 0 }));
		}
		const eff = compressionEffect(runs, "full", TABLE, mulberry32(3));
		const on = eff.find((e) => e.level === COMPRESSION_ON_LEVEL);
		expect(on?.passRateDelta).toBeCloseTo(-1 / 12, 10);
		expect(on?.passRateNPairs).toBe(12);
	});
});

// ---------------------------------------------------------------------------
// buildConditionRuns — scored vs unscored proxy
// ---------------------------------------------------------------------------

describe("buildConditionRuns", () => {
	const condition: Condition = { prose: "ultra", compression: "on", seedIndex: 0, slug: "ultra_on_s0" };
	const traces = [
		{ instance_id: "a", tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } },
		{ instance_id: "b", tokens: { input: 200, output: 60, cacheRead: 0, cacheWrite: 0 } },
		{ instance_id: "c", tokens: { input: null, output: null, cacheRead: null, cacheWrite: null } },
	];
	const predictions = [
		{ instance_id: "a", model_patch: "diff --git ..." },
		{ instance_id: "b", model_patch: "   " }, // whitespace = empty patch
		{ instance_id: "c", model_patch: "diff" },
	];

	it("unscored: resolved = patch-nonempty WEAK proxy", () => {
		const runs = buildConditionRuns({ condition, model: "gpt-5.4", traces, predictions });
		const byTask = new Map(runs.map((r) => [r.task, r]));
		expect(byTask.get("a")?.resolved).toBe(true); // nonempty patch
		expect(byTask.get("b")?.resolved).toBe(false); // whitespace-only
		expect(byTask.get("c")?.resolved).toBe(true); // nonempty patch
	});

	it("scored: resolved = real evaluate-patches.sh set, patch ignored", () => {
		const resolvedSet = new Set(["b"]); // only b really resolved (despite empty patch)
		const runs = buildConditionRuns({ condition, model: "gpt-5.4", traces, predictions, resolvedSet });
		const byTask = new Map(runs.map((r) => [r.task, r]));
		expect(byTask.get("a")?.resolved).toBe(false);
		expect(byTask.get("b")?.resolved).toBe(true);
		expect(byTask.get("c")?.resolved).toBe(false);
	});

	it("nulls any token field → usage null (excludable, never zero-costed)", () => {
		const runs = buildConditionRuns({ condition, model: "gpt-5.4", traces, predictions });
		expect(runs.find((r) => r.task === "c")?.usage).toBeNull();
		expect(runs.find((r) => r.task === "a")?.usage).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
	});

	it("carries the condition's prose/compression/seed onto every run", () => {
		const runs = buildConditionRuns({ condition, model: "gpt-5.4", traces, predictions });
		expect(runs.every((r) => r.prose === "ultra" && r.compression === "on" && r.seed === 0)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Manifest assembly
// ---------------------------------------------------------------------------

describe("assembleManifest", () => {
	const cond = (
		p: Partial<ConditionStat> & Pick<ConditionStat, "prose" | "compression">,
	): ConditionStat => ({
		passRate: 0.5,
		n: 2,
		medianCostPerResolved: 1,
		nResolvedTasks: 1,
		resolvedSource: "evaluate-patches.sh",
		failed: false,
		...p,
	});
	const base = {
		gitSha: "abc123",
		provider: "openai-codex",
		model: "gpt-5.4",
		seeds: 1,
		acceptanceCriteria: { maxQualityDropPp: 3, minCostSavingPct: 15 },
		conditions: [cond({ prose: "ultra", compression: "on" })],
		proseEffectByCompression: { on: [] },
		compressionEffectByProse: { ultra: [] },
	};

	it("scored=true only when EVERY condition was really scored", () => {
		const m = assembleManifest({ ...base, scoreRequested: true });
		expect(m.scored).toBe(true);
		expect(m.resolvedSource).toBe("evaluate-patches.sh");
		expect(m.proxyConditions).toEqual([]);
	});

	it("all-proxy → scored=false, flags the weak proxy, never claims real resolved", () => {
		const m = assembleManifest({
			...base,
			scoreRequested: false,
			conditions: [cond({ prose: "ultra", compression: "on", resolvedSource: "patch-nonempty-PROXY" })],
		});
		expect(m.scored).toBe(false);
		expect(m.resolvedSource).toBe("patch-nonempty-PROXY");
	});

	it("mixed scoring → scored='mixed' and lists the proxy conditions", () => {
		const m = assembleManifest({
			...base,
			scoreRequested: true,
			conditions: [
				cond({ prose: "ultra", compression: "on", resolvedSource: "evaluate-patches.sh" }),
				cond({ prose: "off", compression: "on", resolvedSource: "patch-nonempty-PROXY" }),
			],
		});
		expect(m.scored).toBe("mixed");
		expect(m.resolvedSource).toBe("mixed");
		expect(m.proxyConditions).toEqual([{ prose: "off", compression: "on" }]);
	});

	it("failed conditions are excluded from aggregates + the scoring verdict, recorded separately", () => {
		const m = assembleManifest({
			...base,
			scoreRequested: true,
			conditions: [
				cond({ prose: "ultra", compression: "on", resolvedSource: "evaluate-patches.sh" }),
				cond({ prose: "off", compression: "on", failed: true, resolvedSource: "patch-nonempty-PROXY" }),
			],
		});
		// failed condition does not poison the all-scored verdict
		expect(m.scored).toBe(true);
		expect(m.failedConditions).toEqual([{ prose: "off", compression: "on" }]);
		// and it is not present in the headline conditions list
		expect(m.conditions.some((c) => c.prose === "off")).toBe(false);
	});

	it("per-condition resolvedSource is surfaced in the conditions view", () => {
		const m = assembleManifest({
			...base,
			scoreRequested: true,
			conditions: [cond({ prose: "ultra", compression: "on", resolvedSource: "evaluate-patches.sh" })],
		});
		expect(m.conditions[0]).toEqual({
			prose: "ultra",
			compression: "on",
			passRate: 0.5,
			medianCostPerResolved: 1,
			resolvedSource: "evaluate-patches.sh",
		});
	});

	it("carries gitSha, acceptanceCriteria, effects; omits total_processed", () => {
		const m = assembleManifest({ ...base, scoreRequested: true });
		expect(m.gitSha).toBe("abc123");
		expect(m.acceptanceCriteria).toEqual({ maxQualityDropPp: 3, minCostSavingPct: 15 });
		expect(m.proseEffect).toEqual({ on: [] });
		expect(m.compressionEffect).toEqual({ ultra: [] });
		expect(m.comparable).toBe("n/a");
		expect(JSON.stringify(m)).not.toContain("total_processed");
	});

	it("manifest serializes with no NUL bytes", () => {
		const m = assembleManifest({ ...base, scoreRequested: false });
		const NUL = String.fromCharCode(0);
		expect(JSON.stringify(m, null, 2).includes(NUL)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("runsToCsv", () => {
	it("emits a header + one row per run with computed cost; null usage → blanks", () => {
		const runs: AblationRun[] = [
			ar({ prose: "ultra", compression: "on", task: "t1", resolved: true, usage: U(1_000_000) }),
			ar({ prose: "off", compression: "off", task: "t2", resolved: false, usage: null }),
		];
		const csv = runsToCsv(runs, TABLE);
		const lines = csv.split("\n");
		expect(lines[0]).toBe("prose,compression,seed,model,task,resolved,input,output,cacheRead,cacheWrite,cost");
		expect(lines).toHaveLength(3);
		expect(lines[1]).toContain("ultra,on,0,gpt-5.4");
		expect(lines[1].endsWith(",1")).toBe(true); // cost = 1M input @ $1
		// null usage row: blank token + cost cells
		expect(lines[2]).toContain("off,off,0,gpt-5.4");
		expect(lines[2].endsWith(",,,,,")).toBe(true);
	});

	it("contains no NUL bytes", () => {
		const csv = runsToCsv([ar({ prose: "lite", compression: "on", task: "t1", resolved: true })], TABLE);
		expect(csv.includes(String.fromCharCode(0))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Effect-block guards — only emit an effect when the factor is actually varied
// ---------------------------------------------------------------------------

function isEntries(b: unknown): b is EffectEntry[] {
	return Array.isArray(b);
}

describe("buildCompressionEffectBlocks", () => {
	it("emits a 'not varied' note when only one compression value is present", () => {
		const runs: AblationRun[] = [ar({ prose: "ultra", compression: "on", task: "t1", resolved: true })];
		const blocks = buildCompressionEffectBlocks(runs, ["ultra"], ["on"], TABLE, () => mulberry32(1));
		expect(isEntries(blocks.ultra)).toBe(false);
		expect((blocks.ultra as { note: string }).note).toMatch(/compression not varied/);
	});

	it("emits real entries when BOTH on and off are present", () => {
		const runs: AblationRun[] = [];
		for (let i = 0; i < 12; i++) {
			runs.push(ar({ prose: "ultra", compression: "off", task: `t${i}`, resolved: true, usage: U(2_000_000) }));
			runs.push(ar({ prose: "ultra", compression: "on", task: `t${i}`, resolved: true, usage: U(1_000_000) }));
		}
		const blocks = buildCompressionEffectBlocks(runs, ["ultra"], ["on", "off"], TABLE, () => mulberry32(1));
		expect(isEntries(blocks.ultra)).toBe(true);
		const on = (blocks.ultra as EffectEntry[]).find((e) => e.level === COMPRESSION_ON_LEVEL);
		expect(on?.costMedianRatio).toBeCloseTo(0.5, 6);
	});
});

describe("buildProseEffectBlocks", () => {
	it("emits a 'not varied' note when prose has <2 levels or no off baseline", () => {
		const runs: AblationRun[] = [ar({ prose: "ultra", compression: "on", task: "t1", resolved: true })];
		const single = buildProseEffectBlocks(runs, ["ultra"], ["on"], TABLE, () => mulberry32(1));
		expect((single.on as { note: string }).note).toMatch(/prose not varied/);
		// 2 levels but missing the off baseline → still no contrast
		const noOff = buildProseEffectBlocks(runs, ["lite", "ultra"], ["on"], TABLE, () => mulberry32(1));
		expect((noOff.on as { note: string }).note).toMatch(/prose not varied/);
	});

	it("emits real entries when off + another prose level are present", () => {
		const runs: AblationRun[] = [];
		for (let i = 0; i < 12; i++) {
			runs.push(ar({ prose: "off", compression: "on", task: `t${i}`, resolved: true, usage: U(1_000_000) }));
			runs.push(ar({ prose: "ultra", compression: "on", task: `t${i}`, resolved: true, usage: U(2_000_000) }));
		}
		const blocks = buildProseEffectBlocks(runs, ["off", "ultra"], ["on"], TABLE, () => mulberry32(1));
		expect(isEntries(blocks.on)).toBe(true);
		const ultra = (blocks.on as EffectEntry[]).find((e) => e.level === "ultra");
		expect(ultra?.costMedianRatio).toBeCloseTo(2, 6);
	});
});

// ---------------------------------------------------------------------------
// conditionRunId — unique per condition (no cross-condition report collision)
// ---------------------------------------------------------------------------

describe("conditionRunId", () => {
	it("is unique per condition slug at the same timestamp", () => {
		const a: Condition = { prose: "off", compression: "on", seedIndex: 0, slug: "off_on_s0" };
		const b: Condition = { prose: "ultra", compression: "off", seedIndex: 0, slug: "ultra_off_s0" };
		expect(conditionRunId(a, 1000)).not.toBe(conditionRunId(b, 1000));
		expect(conditionRunId(a, 1000)).toContain("off_on_s0");
	});
});

// ---------------------------------------------------------------------------
// parseResolvedFromLogs — scoped to ONE run dir; empty-vs-miss discrimination
// ---------------------------------------------------------------------------

describe("parseResolvedFromLogs", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "cave-eval-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const writeReport = (runId: string, data: Record<string, { resolved: boolean }>) => {
		const dir = join(root, runId, "nested");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "report.json"), JSON.stringify(data));
	};

	it("returns undefined when no report exists (parse-miss → unscored)", () => {
		expect(parseResolvedFromLogs(join(root, "does-not-exist"))).toBeUndefined();
	});

	it("returns an EMPTY set when a report is found with zero resolved (real scored 0)", () => {
		writeReport("run-A", { i1: { resolved: false }, i2: { resolved: false } });
		const res = parseResolvedFromLogs(join(root, "run-A"));
		expect(res).toBeDefined();
		expect(res?.size).toBe(0);
	});

	it("returns only the resolved ids from THIS run dir, never unioning siblings", () => {
		writeReport("run-A", { a1: { resolved: true }, a2: { resolved: false } });
		writeReport("run-B", { b1: { resolved: true } });
		const a = parseResolvedFromLogs(join(root, "run-A"));
		expect([...(a ?? [])]).toEqual(["a1"]);
		expect(a?.has("b1")).toBe(false); // no cross-condition contamination
	});
});

// ---------------------------------------------------------------------------
// perConditionStats — surfaces resolvedSource / failed from the meta map
// ---------------------------------------------------------------------------

describe("perConditionStats resolvedSource/failed", () => {
	it("defaults to proxy/not-failed without meta, and reflects meta when given", () => {
		const runs: AblationRun[] = [ar({ prose: "ultra", compression: "on", task: "t1", resolved: true })];
		const noMeta = perConditionStats(runs, TABLE);
		expect(noMeta[0].resolvedSource).toBe("patch-nonempty-PROXY");
		expect(noMeta[0].failed).toBe(false);

		const meta = new Map([[JSON.stringify(["ultra", "on"]), { resolvedSource: "evaluate-patches.sh" as const, failed: false }]]);
		const withMeta = perConditionStats(runs, TABLE, meta);
		expect(withMeta[0].resolvedSource).toBe("evaluate-patches.sh");
	});
});
