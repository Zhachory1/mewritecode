/**
 * honest-metrics.ts — pure accounting + statistics for the caveman ON-vs-OFF
 * ablation and cost reporting (issue #8, DD §3).
 *
 * PURE MODULE: no I/O, no process spawning, no filesystem, no clock, no
 * external dependencies. Everything here is deterministic given its inputs; the
 * bootstrap takes a seeded PRNG so tests are reproducible. This file is the
 * unit-tested foundation; the live ablation runner (issue #33) consumes it.
 *
 * Design notes:
 *  - Cost is ALWAYS computed from a single shared price table via computeCost.
 *    Parsers (e.g. parseCodexUsage) return token Usage + model ONLY, never a
 *    dollar figure — there is one source of truth for pricing.
 *  - `resolved` is set by a shared external scorer upstream, never by a tool's
 *    own exit code. These functions treat `resolved` as ground truth.
 */

// ---------------------------------------------------------------------------
// Token usage + pricing
// ---------------------------------------------------------------------------

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Total tokens processed. Supplementary/diagnostic only — never a headline metric. */
export const totalProcessed = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheWrite;

/** Per-Mtok (1e6 tokens) dollar rates for each usage class. */
export interface PricingRow {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Dollar cost of a single run's usage under the shared price table.
 * Returns null when the model has no pricing row (so unpriced runs are
 * excludable rather than silently zero-costed).
 */
export function computeCost(u: Usage, table: Record<string, PricingRow>, model: string): number | null {
	const row = table[model];
	if (!row) return null;
	return (
		(u.input * row.input + u.output * row.output + u.cacheRead * row.cacheRead + u.cacheWrite * row.cacheWrite) /
		1_000_000
	);
}

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export interface Run {
	level: "off" | "lite" | "full" | "ultra" | "codex";
	model: string;
	task: string;
	seed: number;
	resolved: boolean;
	usage: Usage | null;
	parseStatus: "ok" | "failed" | "n/a";
}

// ---------------------------------------------------------------------------
// Small statistical helpers (pure)
// ---------------------------------------------------------------------------

/** Median of a numeric array. Empty → 0. Does not mutate its input. */
function median(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** mean, population standard deviation, median, and count. Empty → all zero. */
export function meanSdMedian(xs: number[]): {
	median: number;
	mean: number;
	sd: number;
	n: number;
} {
	const n = xs.length;
	if (n === 0) return { median: 0, mean: 0, sd: 0, n: 0 };
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
	return { median: median(xs), mean, sd: Math.sqrt(variance), n };
}

// ---------------------------------------------------------------------------
// Cost per resolved task (two-stage, equal task weight, MEDIAN)
// ---------------------------------------------------------------------------

/**
 * Two-stage, equal-task-weight MEDIAN cost per resolved task, grouped by
 * (level, model):
 *   Stage 1: for each task, take the MEDIAN cost over its RESOLVED seeds.
 *   Stage 2: take the MEDIAN over per-task medians.
 * Equal task weight means a task that resolves many times cannot dominate the
 * aggregate. Unresolved runs and unpriced runs are excluded.
 */
export function costPerResolved(
	runs: Run[],
	table: Record<string, PricingRow>,
): { level: string; model: string; medianCost: number; nTasks: number }[] {
	// group key: level|model
	const groups = new Map<string, { level: string; model: string; perTask: Map<string, number[]> }>();

	for (const r of runs) {
		if (!r.resolved || !r.usage) continue;
		const cost = computeCost(r.usage, table, r.model);
		if (cost === null) continue;
		const key = JSON.stringify([r.level, r.model]);
		let g = groups.get(key);
		if (!g) {
			g = { level: r.level, model: r.model, perTask: new Map() };
			groups.set(key, g);
		}
		const arr = g.perTask.get(r.task);
		if (arr) arr.push(cost);
		else g.perTask.set(r.task, [cost]);
	}

	const out: { level: string; model: string; medianCost: number; nTasks: number }[] = [];
	for (const g of groups.values()) {
		const perTaskMedians: number[] = [];
		for (const costs of g.perTask.values()) perTaskMedians.push(median(costs));
		out.push({
			level: g.level,
			model: g.model,
			medianCost: median(perTaskMedians),
			nTasks: perTaskMedians.length,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Pass rate
// ---------------------------------------------------------------------------

/** Pass rate per (level, model): resolved / attempted (shared external scorer). */
export function passRate(runs: Run[]): { level: string; model: string; rate: number; n: number }[] {
	const groups = new Map<string, { level: string; model: string; resolved: number; n: number }>();
	for (const r of runs) {
		const key = JSON.stringify([r.level, r.model]);
		let g = groups.get(key);
		if (!g) {
			g = { level: r.level, model: r.model, resolved: 0, n: 0 };
			groups.set(key, g);
		}
		g.n += 1;
		if (r.resolved) g.resolved += 1;
	}
	return [...groups.values()].map((g) => ({
		level: g.level,
		model: g.model,
		rate: g.n === 0 ? 0 : g.resolved / g.n,
		n: g.n,
	}));
}

// ---------------------------------------------------------------------------
// Percentile bootstrap (seeded)
// ---------------------------------------------------------------------------

/** Resample `xs` with replacement using the provided PRNG. */
function resample(xs: number[], prng: () => number): number[] {
	const n = xs.length;
	const out = new Array<number>(n);
	for (let i = 0; i < n; i++) out[i] = xs[Math.floor(prng() * n)];
	return out;
}

const BOOTSTRAP_ITERS = 2000;

/** Symmetric nearest-rank percentile indices into a sorted array of length n. */
function pctIndex(n: number, p: number): number {
	return Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
}

/** Percentile (2.5/97.5) bootstrap CI of the median of `xs`. */
function bootstrapMedianCI(xs: number[], prng: () => number): [number, number] {
	const stats = new Array<number>(BOOTSTRAP_ITERS);
	for (let b = 0; b < BOOTSTRAP_ITERS; b++) stats[b] = median(resample(xs, prng));
	stats.sort((a, b) => a - b);
	return [stats[pctIndex(BOOTSTRAP_ITERS, 0.025)], stats[pctIndex(BOOTSTRAP_ITERS, 0.975)]];
}

// ---------------------------------------------------------------------------
// Cost delta vs the off baseline (log-ratio bootstrap)
// ---------------------------------------------------------------------------

const MIN_PAIRS = 10;
const POWER_WIDTH_RATIO = 3;
const MIN_PAIRED_RATE = 0.5;

interface CostKey {
	cost: number; // per (task,seed) median-free single cost (one run)
}

/**
 * Build a map (task|seed → cost) of RESOLVED, priced runs at a given level.
 */
function resolvedCostsByPair(
	runs: Run[],
	level: string,
	model: string,
	table: Record<string, PricingRow>,
): Map<string, CostKey> {
	const m = new Map<string, CostKey>();
	for (const r of runs) {
		if (r.level !== level || r.model !== model) continue;
		if (!r.resolved || !r.usage) continue;
		const cost = computeCost(r.usage, table, r.model);
		if (cost === null || cost <= 0) continue;
		m.set(JSON.stringify([r.task, r.seed]), { cost });
	}
	return m;
}

/**
 * LOG-ratio percentile bootstrap of cost vs the `off` baseline, per (level),
 * over (task,seed) pairs where BOTH off and the level resolved. Bootstraps the
 * median of log(cost_level / cost_off), then exponentiates the CI endpoints.
 *
 *  - nPairs < 10 → ci95 null + note "insufficient_pairs".
 *  - exp-CI width ratio (hi/lo) > 3× → powerWarning true.
 *  - pairedRate (nPairs / totalTasksAtLevel) < 0.5 → note flags "low_paired_rate".
 *
 * The model is held fixed across levels by construction; `off` rows define the
 * baseline model used for matching. A level on a DIFFERENT model (e.g. `codex`)
 * matches no `off` pair → nPairs 0, medianRatio null — by design: cross-model
 * cost is not an iso-model ratio (report it separately as model-tier-mismatch),
 * never folded into this delta.
 */
export function costDeltaVsOff(
	runs: Run[],
	table: Record<string, PricingRow>,
	prng: () => number,
): {
	level: string;
	medianRatio: number | null;
	ci95: [number, number] | null;
	nPairs: number;
	pairedRate: number;
	powerWarning: boolean;
	note?: string;
}[] {
	// Determine the model (iso-model ablation: off defines it).
	const offRun = runs.find((r) => r.level === "off");
	const model = offRun?.model ?? runs[0]?.model ?? "";
	const offCosts = resolvedCostsByPair(runs, "off", model, table);

	const levels: Run["level"][] = ["lite", "full", "ultra", "codex"];
	const present = levels.filter((lvl) => runs.some((r) => r.level === lvl));

	const out: ReturnType<typeof costDeltaVsOff> = [];

	for (const level of present) {
		const lvlCosts = resolvedCostsByPair(runs, level, model, table);

		// Total distinct (task,seed) attempted at this level (matched-rate denominator).
		const attempted = new Set<string>();
		for (const r of runs) {
			if (r.level === level && r.model === model) attempted.add(JSON.stringify([r.task, r.seed]));
		}

		const logRatios: number[] = [];
		const ratios: number[] = [];
		for (const [pair, lvl] of lvlCosts) {
			const off = offCosts.get(pair);
			if (!off) continue;
			const ratio = lvl.cost / off.cost;
			ratios.push(ratio);
			logRatios.push(Math.log(ratio));
		}

		const nPairs = logRatios.length;
		const pairedRate = attempted.size === 0 ? 0 : nPairs / attempted.size;
		const medianRatio = nPairs === 0 ? null : Math.exp(median(logRatios));

		const notes: string[] = [];
		let ci95: [number, number] | null = null;
		let powerWarning = false;

		if (nPairs < MIN_PAIRS) {
			notes.push("insufficient_pairs");
		} else {
			const [logLo, logHi] = bootstrapMedianCI(logRatios, prng);
			ci95 = [Math.exp(logLo), Math.exp(logHi)];
			if (ci95[0] > 0 && ci95[1] / ci95[0] > POWER_WIDTH_RATIO) powerWarning = true;
		}

		if (pairedRate < MIN_PAIRED_RATE) notes.push("low_paired_rate");

		out.push({
			level,
			medianRatio,
			ci95,
			nPairs,
			pairedRate,
			powerWarning,
			note: notes.length ? notes.join(",") : undefined,
		});
	}

	return out;
}

// ---------------------------------------------------------------------------
// Pass-rate delta vs off (paired, on the (task,seed) resolved matrix)
// ---------------------------------------------------------------------------

/**
 * Pass-rate delta vs the `off` baseline, per level, over (task,seed) pairs
 * present at BOTH off and the level. Delta = passRate(level) − passRate(off)
 * across the paired cells. The CI is a percentile bootstrap over paired cells
 * of the per-cell difference (resolved_level − resolved_off ∈ {−1,0,+1}); the
 * mean of those differences equals the pass-rate delta, and discordant pairs
 * (McNemar's b and c) are exactly the ±1 cells that drive it.
 */
export function passRateDeltaVsOff(
	runs: Run[],
	prng: () => number = mulberry32(0xc0ffee),
): { level: string; delta: number; ci95: [number, number]; nPairs: number }[] {
	const offResolved = new Map<string, boolean>();
	const offRun = runs.find((r) => r.level === "off");
	const model = offRun?.model ?? runs[0]?.model ?? "";
	for (const r of runs) {
		if (r.level === "off" && r.model === model) offResolved.set(JSON.stringify([r.task, r.seed]), r.resolved);
	}

	const levels: Run["level"][] = ["lite", "full", "ultra", "codex"];
	const present = levels.filter((lvl) => runs.some((r) => r.level === lvl));

	const out: { level: string; delta: number; ci95: [number, number]; nPairs: number }[] = [];

	for (const level of present) {
		// Dedup to one cell per (task,seed) — mirrors the cost path so pairing is
		// strictly 1:1 on unique pairs and duplicate runs can't phantom-inflate nPairs.
		// One run per (level,task,seed) is the expected input; duplicates → last wins.
		const lvlResolved = new Map<string, boolean>();
		for (const r of runs) {
			if (r.level === level && r.model === model) lvlResolved.set(JSON.stringify([r.task, r.seed]), r.resolved);
		}
		const diffs: number[] = [];
		for (const [pair, resolved] of lvlResolved) {
			const off = offResolved.get(pair);
			if (off === undefined) continue;
			diffs.push((resolved ? 1 : 0) - (off ? 1 : 0));
		}
		const nPairs = diffs.length;
		const delta = nPairs === 0 ? 0 : diffs.reduce((a, b) => a + b, 0) / nPairs;

		// Bootstrap the mean of the per-cell differences.
		let ci95: [number, number] = [delta, delta];
		if (nPairs > 0) {
			const stats = new Array<number>(BOOTSTRAP_ITERS);
			for (let b = 0; b < BOOTSTRAP_ITERS; b++) {
				const rs = resample(diffs, prng);
				stats[b] = rs.reduce((a, c) => a + c, 0) / rs.length;
			}
			stats.sort((a, b) => a - b);
			ci95 = [stats[pctIndex(BOOTSTRAP_ITERS, 0.025)], stats[pctIndex(BOOTSTRAP_ITERS, 0.975)]];
		}

		out.push({ level, delta, ci95, nPairs });
	}

	return out;
}

// ---------------------------------------------------------------------------
// Parse failure rate
// ---------------------------------------------------------------------------

/** Fraction of runs at a level whose parse status is "failed". No runs → 0. */
export function parseFailureRate(runs: Run[], level: string): number {
	let n = 0;
	let failed = 0;
	for (const r of runs) {
		if (r.level !== level) continue;
		n += 1;
		if (r.parseStatus === "failed") failed += 1;
	}
	return n === 0 ? 0 : failed / n;
}

// ---------------------------------------------------------------------------
// Codex usage parser (UNCONFIRMED)
// ---------------------------------------------------------------------------

/**
 * Parse codex CLI stdout into token Usage + model ONLY — never a cost (cost is
 * always computed via the shared price table). Missing input OR output → status
 * "failed" with usage null; we NEVER fabricate a token count.
 *
 * UNCONFIRMED: no real codex stdout sample has been captured in this repo, so
 * the exact field shape is a best-effort guess (a JSON object with a `usage`
 * block carrying `input_tokens`/`output_tokens` and optional
 * `cache_read_tokens`/`cache_write_tokens`, plus a top-level `model`). Treat a
 * 100% parse-failure rate as EXPECTED until a real sample is committed with
 * provenance and this parser is validated against it (DD §9). Downstream, a
 * codex parseFailureRate > 0.1 → manifest `comparable:false`.
 */
export function parseCodexUsage(stdout: string): {
	usage: Usage | null;
	model: string | null;
	status: "ok" | "failed";
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return { usage: null, model: null, status: "failed" };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { usage: null, model: null, status: "failed" };
	}

	const obj = parsed as Record<string, unknown>;
	const model = typeof obj.model === "string" ? obj.model : null;

	const usageBlock = obj.usage;
	if (typeof usageBlock !== "object" || usageBlock === null) {
		return { usage: null, model, status: "failed" };
	}
	const u = usageBlock as Record<string, unknown>;

	const input = typeof u.input_tokens === "number" ? u.input_tokens : undefined;
	const output = typeof u.output_tokens === "number" ? u.output_tokens : undefined;
	// Missing input OR output → fail. Never fabricate.
	if (input === undefined || output === undefined) {
		return { usage: null, model, status: "failed" };
	}
	const cacheRead = typeof u.cache_read_tokens === "number" ? u.cache_read_tokens : 0;
	const cacheWrite = typeof u.cache_write_tokens === "number" ? u.cache_write_tokens : 0;

	return { usage: { input, output, cacheRead, cacheWrite }, model, status: "ok" };
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — exported for callers/tests needing determinism.
// ---------------------------------------------------------------------------

/** Deterministic mulberry32 PRNG → () => number in [0,1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
