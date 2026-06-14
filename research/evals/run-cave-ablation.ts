#!/usr/bin/env npx tsx
/**
 * run-cave-ablation.ts — 2-factor caveman ablation orchestrator (issue #33, DD Piece-2).
 *
 * caveman-mode is TWO separable features (council's #1 requirement):
 *   - PROSE / reasoning-style injection (the system-prompt block), and
 *   - tool-output COMPRESSION (the afterToolCall gate).
 * A naive ON/OFF confounds them. This runner varies them INDEPENDENTLY:
 *   conditions = prose ∈ {off,lite,full,ultra} × compression ∈ {on,off} × seedIndex.
 *
 * For each condition it spawns `run-swebench.ts` as a FRESH SUBPROCESS (clean
 * cache state) with the matching --cave / --compression / --provider / --model /
 * --limit / --cap / --dataset and a per-condition --output dir, then reads that
 * subprocess's per-instance traces + predictions, builds honest-metrics `Run[]`,
 * and computes (via honest-metrics.ts — the stats source of truth):
 *   - per (prose,compression): passRate + costPerResolved
 *   - PROSE effect at fixed compression: relabel Run[] so level=prose → deltas
 *   - COMPRESSION effect at fixed prose: relabel Run[] so level=off/on(compression)
 *
 * Outputs: manifest.json (git SHA, model, pre-registered acceptanceCriteria,
 * per-condition + effect deltas/CIs, and an HONEST scored status — true only if
 * EVERY condition was really scored, false if none, "mixed" otherwise, plus the
 * list of proxy/failed conditions), a flat CSV of all runs, and per-condition
 * artifacts under --output. Failed conditions (run-swebench non-zero exit) are
 * EXCLUDED from aggregates, not ingested as partial.
 *
 * IMPORTANT: this file SPENDS MONEY when actually run (it spawns paid benchmark
 * subprocesses). The human operator runs the paid sweep. `--help` and `--dry-run`
 * make NO network calls and spawn NO subprocesses — they only print the plan.
 *
 * SCORING: with --score, evaluate-patches.sh sets the REAL `resolved` per
 * condition. WITHOUT --score, runs are marked `unscored` and `resolved` uses a
 * patch-nonempty WEAK proxy — clearly flagged (`scored:false`); NEVER presented
 * as resolved in any headline.
 *
 * Usage:
 *   npx tsx research/evals/run-cave-ablation.ts --help
 *   npx tsx research/evals/run-cave-ablation.ts --dry-run --limit 5
 *   # paid (operator only):
 *   npx tsx research/evals/run-cave-ablation.ts \
 *     --prose off,lite,full,ultra --compression on,off --seeds 3 \
 *     --provider openai-codex --model gpt-5.4 --limit 50 --cap 5 --score
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	costDeltaVsOff,
	costPerResolved,
	mulberry32,
	passRate,
	passRateDeltaVsOff,
	type PricingRow,
	type Run,
	type Usage,
} from "./honest-metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ===========================================================================
// Types
// ===========================================================================

export type Prose = "off" | "lite" | "full" | "ultra";
export type Compression = "on" | "off";

/** A single run record carrying BOTH factors plus the honest-metrics inputs. */
export interface AblationRun {
	prose: Prose;
	compression: Compression;
	seed: number;
	model: string;
	task: string;
	resolved: boolean;
	usage: Usage | null;
}

export interface AblationConfig {
	prose: Prose[];
	compression: Compression[];
	seeds: number;
	provider: string;
	model: string;
	limit?: number;
	cap?: number;
	datasetPath?: string;
	outputDir: string;
	score: boolean;
	dryRun: boolean;
}

// ===========================================================================
// Pricing table (single source of truth; DD §5). DATED + verify-before-publish.
// ===========================================================================

/**
 * Per-Mtok ($) price rows. UNVERIFIED placeholder values — the operator MUST
 * confirm against the provider's price sheet before publishing any cost figure.
 * A model absent here → honest-metrics returns null cost → that run is EXCLUDED
 * from cost aggregates (never silently zero-costed). Dated 2026-06.
 */
export const PRICING_TABLE: Record<string, PricingRow> = {
	// $/Mtok — PLACEHOLDER, verify before publishing.
	"gpt-5.4": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
	"gpt-5.5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
	// gpt-4o-mini — published OpenAI rates (2026-06): in $0.15, out $0.60, cached-in $0.075/Mtok.
	// OpenAI has no separate cache-write premium; cacheWrite priced at the input rate.
	"gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
};

// ===========================================================================
// Arg parsing (PURE — given argv, returns config; never touches network/fs)
// ===========================================================================

const ALL_PROSE: Prose[] = ["off", "lite", "full", "ultra"];

export function parseAblationArgs(argv: string[], defaultOutputRoot = resolve(REPO_ROOT, "research/results")): AblationConfig {
	const runId = `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
	const config: AblationConfig = {
		prose: [...ALL_PROSE],
		compression: ["on"],
		seeds: 1,
		provider: "openai-codex",
		model: "gpt-5.4",
		outputDir: resolve(defaultOutputRoot, `ablation-${runId}`),
		score: false,
		dryRun: false,
	};

	const parseProse = (csv: string): Prose[] => {
		const out: Prose[] = [];
		for (const raw of csv.split(",")) {
			const v = raw.trim();
			if (v === "off" || v === "lite" || v === "full" || v === "ultra") out.push(v);
			else throw new Error(`Invalid --prose value: ${v} (expected off|lite|full|ultra)`);
		}
		if (out.length === 0) throw new Error("--prose requires at least one value");
		return out;
	};
	const parseCompression = (csv: string): Compression[] => {
		const out: Compression[] = [];
		for (const raw of csv.split(",")) {
			const v = raw.trim();
			if (v === "on" || v === "off") out.push(v);
			else throw new Error(`Invalid --compression value: ${v} (expected on|off)`);
		}
		if (out.length === 0) throw new Error("--compression requires at least one value");
		return out;
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--prose":
				config.prose = parseProse(argv[++i]);
				break;
			case "--compression":
				config.compression = parseCompression(argv[++i]);
				break;
			case "--seeds": {
				const n = Number(argv[++i]);
				if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid --seeds: ${n} (expected integer >= 1)`);
				if (n > 1) {
					// run-swebench has no --seed and is deterministic, and no sampling-seed
					// is forwarded — so N seeds would produce N IDENTICAL runs, tripling
					// nPairs and FABRICATING statistical replicates (fake CI narrowing /
					// fake power). Refuse rather than silently lie. Real per-seed sampling
					// control is a documented TODO; see #33.
					throw new Error(
						"sampling-seed control is not wired; --seeds>1 would fabricate statistical replicates " +
							"(run-swebench is deterministic and no seed is forwarded) — see #33. Use --seeds 1.",
					);
				}
				config.seeds = n;
				break;
			}
			case "--provider":
				config.provider = argv[++i];
				break;
			case "--model":
				config.model = argv[++i];
				break;
			case "--limit": {
				const n = Number(argv[++i]);
				if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid --limit: ${n} (expected integer >= 1)`);
				config.limit = n;
				break;
			}
			case "--cap": {
				const n = Number(argv[++i]);
				if (!(n > 0)) throw new Error(`Invalid --cap: ${n} (expected number > 0)`);
				config.cap = n;
				break;
			}
			case "--dataset":
				config.datasetPath = resolve(argv[++i]);
				break;
			case "--output":
				config.outputDir = resolve(argv[++i]);
				break;
			case "--score":
				config.score = true;
				break;
			case "--dry-run":
				config.dryRun = true;
				break;
			case "--help":
			case "-h":
				config.dryRun = true; // help implies no-op; handled by caller
				throw new HelpRequested();
			default:
				throw new Error(`Unknown arg: ${arg}`);
		}
	}
	return config;
}

export class HelpRequested extends Error {}

// ===========================================================================
// Condition enumeration (PURE)
// ===========================================================================

export interface Condition {
	prose: Prose;
	compression: Compression;
	seedIndex: number;
	/** stable, fs-safe slug for the per-condition output dir. */
	slug: string;
}

export function enumerateConditions(config: AblationConfig): Condition[] {
	const out: Condition[] = [];
	for (const prose of config.prose) {
		for (const compression of config.compression) {
			for (let s = 0; s < config.seeds; s++) {
				out.push({ prose, compression, seedIndex: s, slug: `${prose}_${compression}_s${s}` });
			}
		}
	}
	return out;
}

// ===========================================================================
// Relabel views (PURE) — the heart of the 2-factor isolation
// ===========================================================================

/** Map a prose value to the honest-metrics Run.level field. */
function proseToLevel(p: Prose): Run["level"] {
	return p; // "off"|"lite"|"full"|"ultra" are all valid Run levels
}

/**
 * PROSE effect at a FIXED compression value: build a Run[] containing only runs
 * whose compression === fixed, labeling Run.level with the PROSE value. Then
 * honest-metrics' costDeltaVsOff / passRateDeltaVsOff compare each prose level
 * against prose "off" — at that single compression setting. So the compression
 * factor is held constant and only prose varies.
 */
export function proseAtFixedCompressionView(runs: AblationRun[], fixed: Compression): Run[] {
	const out: Run[] = [];
	for (const r of runs) {
		if (r.compression !== fixed) continue;
		out.push({
			level: proseToLevel(r.prose),
			model: r.model,
			task: r.task,
			seed: r.seed,
			resolved: r.resolved,
			usage: r.usage,
			parseStatus: "n/a",
		});
	}
	return out;
}

/**
 * COMPRESSION effect at a FIXED prose value: build a Run[] containing only runs
 * whose prose === fixed, RELABELING the level field so the compression axis maps
 * onto honest-metrics' off-vs-level baseline:
 *   compression "off" → level "off"   (the baseline)
 *   compression "on"  → level "lite"  (a single non-off level representing on)
 * Reusing costDeltaVsOff / passRateDeltaVsOff then isolates the PURE compression
 * effect (on vs off) while prose is held constant. The "lite" label is just the
 * carrier for "compression on" — it has no prose meaning in this view.
 */
export const COMPRESSION_ON_LEVEL: Run["level"] = "lite";

export function compressionAtFixedProseView(runs: AblationRun[], fixed: Prose): Run[] {
	const out: Run[] = [];
	for (const r of runs) {
		if (r.prose !== fixed) continue;
		out.push({
			level: r.compression === "off" ? "off" : COMPRESSION_ON_LEVEL,
			model: r.model,
			task: r.task,
			seed: r.seed,
			resolved: r.resolved,
			usage: r.usage,
			parseStatus: "n/a",
		});
	}
	return out;
}

/** Full Run[] view labeled by prose (across all compressions) — for raw CSV / per-condition passRate. */
export function allRunsView(runs: AblationRun[]): Run[] {
	return runs.map((r) => ({
		level: proseToLevel(r.prose),
		model: r.model,
		task: r.task,
		seed: r.seed,
		resolved: r.resolved,
		usage: r.usage,
		parseStatus: "n/a" as const,
	}));
}

// ===========================================================================
// Per-condition aggregates (PURE)
// ===========================================================================

/** How a condition's `resolved` field was actually derived. */
export type ResolvedSource = "evaluate-patches.sh" | "patch-nonempty-PROXY";

export interface ConditionStat {
	prose: Prose;
	compression: Compression;
	passRate: number;
	n: number;
	medianCostPerResolved: number | null;
	nResolvedTasks: number;
	/** ACTUAL source of this condition's resolved field (intent-independent). */
	resolvedSource: ResolvedSource;
	/** true iff run-swebench failed for this condition and it was excluded from aggregates. */
	failed: boolean;
}

/**
 * Per-condition scoring metadata, keyed by the JSON key of [prose,compression].
 * `resolvedSource` records how the resolved field was ACTUALLY derived (not the
 * requested intent); `failed` marks a condition whose run-swebench subprocess
 * exited non-zero (its partial output is excluded from `runs`).
 */
export type ConditionMetaMap = Map<string, { resolvedSource: ResolvedSource; failed: boolean }>;

/** JSON key for a (prose,compression) pair — stable, NUL-free. */
export function conditionKey(prose: Prose, compression: Compression): string {
	return JSON.stringify([prose, compression]);
}

export function perConditionStats(
	runs: AblationRun[],
	table: Record<string, PricingRow>,
	meta?: ConditionMetaMap,
): ConditionStat[] {
	// Group by (prose,compression) using a JSON key (no NUL separators).
	const groups = new Map<string, AblationRun[]>();
	for (const r of runs) {
		const key = conditionKey(r.prose, r.compression);
		const arr = groups.get(key);
		if (arr) arr.push(r);
		else groups.set(key, [r]);
	}
	const out: ConditionStat[] = [];
	for (const [key, group] of groups) {
		const [prose, compression] = JSON.parse(key) as [Prose, Compression];
		const view = group.map((r) => ({
			level: proseToLevel(r.prose),
			model: r.model,
			task: r.task,
			seed: r.seed,
			resolved: r.resolved,
			usage: r.usage,
			parseStatus: "n/a" as const,
		}));
		const pr = passRate(view)[0];
		const cpr = costPerResolved(view, table)[0];
		const m = meta?.get(key);
		out.push({
			prose,
			compression,
			passRate: pr ? pr.rate : 0,
			n: pr ? pr.n : 0,
			medianCostPerResolved: cpr ? cpr.medianCost : null,
			nResolvedTasks: cpr ? cpr.nTasks : 0,
			resolvedSource: m?.resolvedSource ?? "patch-nonempty-PROXY",
			failed: m?.failed ?? false,
		});
	}
	return out;
}

// ===========================================================================
// Effect computation (PURE) — wraps honest-metrics with seeded determinism
// ===========================================================================

export interface EffectEntry {
	/** the varying factor's level being compared vs its off baseline. */
	level: string;
	costMedianRatio: number | null;
	costCi95: [number, number] | null;
	costNPairs: number;
	costPairedRate: number;
	costPowerWarning: boolean;
	costNote?: string;
	passRateDelta: number;
	passRateCi95: [number, number];
	passRateNPairs: number;
}

function joinEffects(
	cost: ReturnType<typeof costDeltaVsOff>,
	pass: ReturnType<typeof passRateDeltaVsOff>,
): EffectEntry[] {
	const passByLevel = new Map(pass.map((p) => [p.level, p]));
	return cost.map((c) => {
		const p = passByLevel.get(c.level);
		return {
			level: c.level,
			costMedianRatio: c.medianRatio,
			costCi95: c.ci95,
			costNPairs: c.nPairs,
			costPairedRate: c.pairedRate,
			costPowerWarning: c.powerWarning,
			costNote: c.note,
			passRateDelta: p ? p.delta : 0,
			passRateCi95: p ? p.ci95 : [0, 0],
			passRateNPairs: p ? p.nPairs : 0,
		};
	});
}

/** PROSE effect at a fixed compression, deterministic under the given seed. */
export function proseEffect(
	runs: AblationRun[],
	fixed: Compression,
	table: Record<string, PricingRow>,
	prng: () => number,
): EffectEntry[] {
	const view = proseAtFixedCompressionView(runs, fixed);
	return joinEffects(costDeltaVsOff(view, table, prng), passRateDeltaVsOff(view, prng));
}

/** COMPRESSION effect at a fixed prose, deterministic under the given seed. */
export function compressionEffect(
	runs: AblationRun[],
	fixed: Prose,
	table: Record<string, PricingRow>,
	prng: () => number,
): EffectEntry[] {
	const view = compressionAtFixedProseView(runs, fixed);
	return joinEffects(costDeltaVsOff(view, table, prng), passRateDeltaVsOff(view, prng));
}

// ===========================================================================
// Manifest assembly (PURE)
// ===========================================================================

export interface AcceptanceCriteria {
	/** max acceptable quality (pass-rate) drop in percentage points — operator fills. */
	maxQualityDropPp: number;
	/** min acceptable cost saving as a percent — operator fills. */
	minCostSavingPct: number;
}

/**
 * An effect block is EITHER the computed per-level entries OR an explicit
 * "not varied" omission note (when the relevant factor had <2 levels, so no
 * within-factor contrast exists). Emitting the note instead of a structurally
 * guaranteed `nPairs:0` artifact keeps the manifest honest.
 */
export type EffectBlock = EffectEntry[] | { note: string };

/** Top-level scoring honesty: true (all real), false (all proxy), or mixed. */
export type ScoredStatus = boolean | "mixed";

export interface ManifestInput {
	gitSha: string;
	provider: string;
	model: string;
	seeds: number;
	/** what the OPERATOR requested (--score). Honesty is derived from conditions. */
	scoreRequested: boolean;
	acceptanceCriteria: AcceptanceCriteria;
	conditions: ConditionStat[];
	proseEffectByCompression: Record<string, EffectBlock>;
	compressionEffectByProse: Record<string, EffectBlock>;
}

export interface ManifestConditionView {
	prose: Prose;
	compression: Compression;
	passRate: number;
	medianCostPerResolved: number | null;
	/** ACTUAL resolved source for this condition (real eval vs weak proxy). */
	resolvedSource: ResolvedSource;
}

export interface Manifest {
	schema: "cave-ablation/v1";
	gitSha: string;
	provider: string;
	model: string;
	seeds: number;
	/**
	 * Honest scoring status: `true` only if EVERY (non-failed) condition was
	 * really scored by evaluate-patches.sh; `false` if none were; `"mixed"` if
	 * some were real and some fell back to the patch-nonempty proxy.
	 */
	scored: ScoredStatus;
	/** Which conditions used the weak proxy (empty when scored===true). */
	proxyConditions: Array<{ prose: Prose; compression: Compression }>;
	/** Conditions whose run-swebench failed and were EXCLUDED from all aggregates. */
	failedConditions: Array<{ prose: Prose; compression: Compression }>;
	/** Top-level resolved source: real only when every condition was real. */
	resolvedSource: "evaluate-patches.sh" | "patch-nonempty-PROXY" | "mixed";
	acceptanceCriteria: AcceptanceCriteria;
	conditions: ManifestConditionView[];
	proseEffect: Record<string, EffectBlock>;
	compressionEffect: Record<string, EffectBlock>;
	/** codex cross-tool comparability — n/a in this iso-model ablation. */
	comparable: "n/a";
	comparableNote: string;
}

export function assembleManifest(input: ManifestInput): Manifest {
	// Only non-failed conditions count toward the scoring-honesty verdict; failed
	// conditions are excluded from aggregates entirely.
	const counted = input.conditions.filter((c) => !c.failed);
	const proxyConditions = counted
		.filter((c) => c.resolvedSource === "patch-nonempty-PROXY")
		.map((c) => ({ prose: c.prose, compression: c.compression }));
	const failedConditions = input.conditions
		.filter((c) => c.failed)
		.map((c) => ({ prose: c.prose, compression: c.compression }));

	const realCount = counted.length - proxyConditions.length;
	let scored: ScoredStatus;
	let resolvedSource: Manifest["resolvedSource"];
	if (counted.length === 0 || realCount === 0) {
		scored = false;
		resolvedSource = "patch-nonempty-PROXY";
	} else if (proxyConditions.length === 0) {
		scored = true;
		resolvedSource = "evaluate-patches.sh";
	} else {
		scored = "mixed";
		resolvedSource = "mixed";
	}

	return {
		schema: "cave-ablation/v1",
		gitSha: input.gitSha,
		provider: input.provider,
		model: input.model,
		seeds: input.seeds,
		scored,
		proxyConditions,
		failedConditions,
		resolvedSource,
		acceptanceCriteria: input.acceptanceCriteria,
		// NOTE: deliberately NO total_processed (cherry-pick vector; raw CSV only).
		conditions: counted.map((c) => ({
			prose: c.prose,
			compression: c.compression,
			passRate: c.passRate,
			medianCostPerResolved: c.medianCostPerResolved,
			resolvedSource: c.resolvedSource,
		})),
		proseEffect: input.proseEffectByCompression,
		compressionEffect: input.compressionEffectByProse,
		comparable: "n/a",
		comparableNote:
			"Iso-model 2-factor ablation (prose × compression at a fixed model); codex cross-tool token comparison is out of scope here.",
	};
}

// ===========================================================================
// Effect-block guards (PURE) — only emit an effect when the factor is VARIED
// ===========================================================================

/**
 * PROSE effect blocks keyed by the fixed compression value, but ONLY when prose
 * is actually varied (2+ levels including the "off" baseline). With a single
 * prose value there is no within-prose contrast, so emit an explicit omission
 * note instead of a structurally guaranteed `nPairs:0` artifact.
 */
export function buildProseEffectBlocks(
	runs: AblationRun[],
	proseLevels: Prose[],
	compressionLevels: Compression[],
	table: Record<string, PricingRow>,
	prngFor: (comp: Compression) => () => number,
): Record<string, EffectBlock> {
	const out: Record<string, EffectBlock> = {};
	const varied = proseLevels.includes("off") && proseLevels.length >= 2;
	for (const comp of compressionLevels) {
		out[comp] = varied
			? proseEffect(runs, comp, table, prngFor(comp))
			: { note: "prose not varied (need the 'off' baseline plus >=1 other prose level)" };
	}
	return out;
}

/**
 * COMPRESSION effect blocks keyed by the fixed prose value, but ONLY when
 * compression is actually varied (BOTH `on` and `off` present). Under the default
 * `--compression on` there is no on-vs-off contrast, so emit an explicit omission
 * note rather than the guaranteed `level:lite nPairs:0` artifact.
 */
export function buildCompressionEffectBlocks(
	runs: AblationRun[],
	proseLevels: Prose[],
	compressionLevels: Compression[],
	table: Record<string, PricingRow>,
	prngFor: (prose: Prose) => () => number,
): Record<string, EffectBlock> {
	const out: Record<string, EffectBlock> = {};
	const varied = compressionLevels.includes("on") && compressionLevels.includes("off");
	for (const prose of proseLevels) {
		out[prose] = varied
			? compressionEffect(runs, prose, table, prngFor(prose))
			: { note: "compression not varied (need both on and off)" };
	}
	return out;
}

// ===========================================================================
// Flat CSV of all runs (PURE)
// ===========================================================================

export function runsToCsv(runs: AblationRun[], table: Record<string, PricingRow>): string {
	const header = [
		"prose",
		"compression",
		"seed",
		"model",
		"task",
		"resolved",
		"input",
		"output",
		"cacheRead",
		"cacheWrite",
		"cost",
	].join(",");
	const lines = [header];
	for (const r of runs) {
		const u = r.usage;
		const cost =
			u === null
				? ""
				: (() => {
						const row = table[r.model];
						if (!row) return "";
						return (
							(u.input * row.input + u.output * row.output + u.cacheRead * row.cacheRead + u.cacheWrite * row.cacheWrite) /
							1_000_000
						).toString();
					})();
		lines.push(
			[
				r.prose,
				r.compression,
				String(r.seed),
				r.model,
				// task may contain commas only if instance ids do — they don't, but quote defensively.
				`"${r.task.replace(/"/g, '""')}"`,
				r.resolved ? "1" : "0",
				u ? String(u.input) : "",
				u ? String(u.output) : "",
				u ? String(u.cacheRead) : "",
				u ? String(u.cacheWrite) : "",
				cost,
			].join(","),
		);
	}
	return lines.join("\n");
}

// ===========================================================================
// Trace reading (INJECTABLE so tests don't touch the filesystem)
// ===========================================================================

export interface TraceRecord {
	instance_id: string;
	tokens: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null };
}

export interface PredictionRecord {
	instance_id: string;
	model_patch: string;
}

/**
 * Convert a condition's subprocess outputs into AblationRun[]. PURE given its
 * inputs — `traces`, `predictions`, and the optional `resolvedSet` (real
 * resolved instance ids from evaluate-patches.sh). Without `resolvedSet`
 * (unscored), resolved = patch-nonempty WEAK proxy.
 */
export function buildConditionRuns(args: {
	condition: Condition;
	model: string;
	traces: TraceRecord[];
	predictions: PredictionRecord[];
	resolvedSet?: Set<string>; // present iff scored
}): AblationRun[] {
	const patchById = new Map(args.predictions.map((p) => [p.instance_id, p.model_patch]));
	return args.traces.map((t) => {
		const patch = patchById.get(t.instance_id) ?? "";
		const usage: Usage | null =
			t.tokens.input === null ||
			t.tokens.output === null ||
			t.tokens.cacheRead === null ||
			t.tokens.cacheWrite === null
				? null
				: {
						input: t.tokens.input,
						output: t.tokens.output,
						cacheRead: t.tokens.cacheRead,
						cacheWrite: t.tokens.cacheWrite,
					};
		const resolved = args.resolvedSet ? args.resolvedSet.has(t.instance_id) : patch.trim().length > 0;
		return {
			prose: args.condition.prose,
			compression: args.condition.compression,
			seed: args.condition.seedIndex,
			model: args.model,
			task: t.instance_id,
			resolved,
			usage,
		};
	});
}

// ===========================================================================
// Filesystem trace reading (GLUE — used by main only)
// ===========================================================================

function readTracesFromDir(conditionDir: string): TraceRecord[] {
	const tracesDir = join(conditionDir, "traces");
	if (!existsSync(tracesDir)) return [];
	const out: TraceRecord[] = [];
	for (const f of readdirSync(tracesDir)) {
		if (!f.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(readFileSync(join(tracesDir, f), "utf8")) as Partial<TraceRecord> & {
				tokens?: TraceRecord["tokens"];
			};
			if (typeof parsed.instance_id === "string" && parsed.tokens) {
				out.push({ instance_id: parsed.instance_id, tokens: parsed.tokens });
			}
		} catch {
			// skip unreadable trace
		}
	}
	return out;
}

function readPredictionsFromDir(conditionDir: string): PredictionRecord[] {
	const file = join(conditionDir, "predictions.jsonl");
	if (!existsSync(file)) return [];
	const out: PredictionRecord[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as Partial<PredictionRecord>;
			if (typeof parsed.instance_id === "string") {
				out.push({ instance_id: parsed.instance_id, model_patch: parsed.model_patch ?? "" });
			}
		} catch {
			// skip
		}
	}
	return out;
}

// ===========================================================================
// Subprocess spawning (GLUE — used by main only)
// ===========================================================================

function buildSwebenchArgs(config: AblationConfig, condition: Condition, conditionDir: string): string[] {
	const args = [
		"tsx",
		resolve(__dirname, "run-swebench.ts"),
		"--cave",
		condition.prose,
		"--compression",
		condition.compression,
		"--provider",
		config.provider,
		"--model",
		config.model,
		"--output",
		conditionDir,
	];
	if (config.limit !== undefined) args.push("--limit", String(config.limit));
	if (config.cap !== undefined) args.push("--cap", String(config.cap));
	if (config.datasetPath) args.push("--dataset", config.datasetPath);
	return args;
}

function gitSha(): string {
	try {
		return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
	} catch {
		return "unknown";
	}
}

// ===========================================================================
// Main (GLUE) — spawns subprocesses (SPENDS MONEY). --dry-run / --help do not.
// ===========================================================================

function log(msg: string): void {
	console.log(`[ablation] ${msg}`);
}

function printHelp(): void {
	console.log(
		[
			"run-cave-ablation.ts — 2-factor caveman ablation (prose × compression)",
			"",
			"Flags:",
			"  --prose <csv>        off,lite,full,ultra (default: all 4)",
			"  --compression <csv>  on,off (default: on)",
			"  --seeds <n>          repeat index for independent re-runs (default: 1)",
			"                       NOTE: only --seeds 1 is supported. run-swebench is",
			"                       deterministic and no sampling-seed is forwarded, so",
			"                       --seeds>1 would FABRICATE replicates and is rejected.",
			"                       Real per-seed sampling control is a TODO (#33).",
			"  --provider <name>    LLM provider (default: openai-codex)",
			"  --model <id>         model held fixed across conditions (default: gpt-5.4)",
			"  --limit <n>          max instances per condition",
			"  --cap <dollars>      per-instance cost cap",
			"  --dataset <path>     local JSONL dataset",
			"  --output <dir>       output dir (default: research/results/ablation-<runid>)",
			"  --score              run evaluate-patches.sh per condition for REAL resolved.",
			"                       WITHOUT --score: runs are unscored; resolved = patch-nonempty",
			"                       WEAK proxy (flagged scored:false; never a headline resolved).",
			"  --dry-run            print the plan; spawn NOTHING; no network.",
			"  --help               this help.",
			"",
			"WARNING: a real run spawns paid benchmark subprocesses. --dry-run/--help are free.",
		].join("\n"),
	);
}

/**
 * Build a UNIQUE-per-condition SWE-bench run-id. The harness writes its report
 * to logs/run_evaluation/<run-id>/, so this MUST be unique per condition or one
 * condition's report would contaminate another's resolved-set (cross-condition
 * union bug). Slug + second-granular timestamp gives per-condition isolation.
 */
export function conditionRunId(condition: Condition, nowSec: number): string {
	return `cave-eval-${condition.slug}-${nowSec}`;
}

/**
 * Run evaluate-patches.sh for ONE condition with an explicit, unique run-id, then
 * parse ONLY that run's report (scoped to logs/run_evaluation/<run-id>/).
 *
 * Returns:
 *   - undefined  → could not score this condition (no predictions, eval crashed,
 *     or no report.json found). Caller treats the condition as UNSCORED and falls
 *     back to the patch-nonempty proxy.
 *   - Set<string> (possibly EMPTY) → report found; the set is the REAL resolved
 *     instance ids. An empty set means "scored, genuinely zero resolved".
 */
function runEvaluate(conditionDir: string, runId: string): Set<string> | undefined {
	const predictions = join(conditionDir, "predictions.jsonl");
	if (!existsSync(predictions)) return undefined;
	const res = spawnSync("bash", [resolve(__dirname, "evaluate-patches.sh"), predictions, runId], {
		cwd: REPO_ROOT,
		stdio: "inherit",
	});
	if (res.status !== 0) {
		log(`evaluate-patches.sh failed for ${conditionDir} (status ${res.status}); leaving condition unscored`);
		return undefined;
	}
	// Scope to THIS condition's report only — never union across runs/conditions.
	return parseResolvedFromLogs(join(REPO_ROOT, "logs", "run_evaluation", runId));
}

/**
 * Parse the resolved instance ids from a SINGLE eval run's report tree. PURE w.r.t.
 * the given runDir (no global walk, no cross-run union).
 *
 * Returns `undefined` when NO report.json exists under runDir (parse-miss →
 * unscored). Returns a (possibly empty) Set when at least one report.json is found
 * — an empty Set then means "report present, zero resolved", a real scored 0.
 */
export function parseResolvedFromLogs(runDir: string): Set<string> | undefined {
	if (!existsSync(runDir)) return undefined;
	const resolved = new Set<string>();
	let foundReport = false;
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.name === "report.json") {
				try {
					const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, { resolved?: boolean }>;
					foundReport = true;
					for (const [iid, r] of Object.entries(data)) if (r.resolved) resolved.add(iid);
				} catch {
					// unreadable report → not counted as a found report
				}
			}
		}
	};
	walk(runDir);
	return foundReport ? resolved : undefined;
}

async function main(): Promise<void> {
	let config: AblationConfig;
	try {
		config = parseAblationArgs(process.argv.slice(2));
	} catch (e) {
		if (e instanceof HelpRequested) {
			printHelp();
			process.exit(0);
		}
		console.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	}

	const conditions = enumerateConditions(config);
	log(`Conditions: ${conditions.length} (prose=${config.prose.join("/")} × compression=${config.compression.join("/")} × seeds=${config.seeds})`);
	log(`Provider/model: ${config.provider}/${config.model} | scored: ${config.score}`);
	log(`Output: ${config.outputDir}`);

	if (config.dryRun) {
		log("DRY RUN — would spawn (no network, no money):");
		for (const c of conditions) {
			const dir = join(config.outputDir, c.slug);
			console.log(`  npx ${buildSwebenchArgs(config, c, dir).join(" ")}`);
		}
		if (config.score) log("  then: bash research/evals/evaluate-patches.sh <each predictions.jsonl>");
		process.exit(0);
	}

	mkdirSync(config.outputDir, { recursive: true });
	const allRuns: AblationRun[] = [];
	// Per-(prose,compression) scoring/failure metadata for honest manifest assembly.
	const meta: ConditionMetaMap = new Map();
	const failedSlugs: string[] = [];

	for (const condition of conditions) {
		const key = conditionKey(condition.prose, condition.compression);
		const conditionDir = join(config.outputDir, condition.slug);
		mkdirSync(conditionDir, { recursive: true });
		log(`=== ${condition.slug} ===`);
		const args = buildSwebenchArgs(config, condition, conditionDir);
		const res = spawnSync("npx", args, { cwd: REPO_ROOT, stdio: "inherit" });
		if (res.status !== 0) {
			// Partial-crash safety: a non-zero exit may have left partial traces /
			// predictions. Do NOT ingest them as a complete condition — that would
			// silently fold a truncated run into the aggregates. Mark FAILED and skip.
			log(`run-swebench exited ${res.status} for ${condition.slug}; marking condition FAILED and excluding it`);
			failedSlugs.push(condition.slug);
			meta.set(key, { resolvedSource: "patch-nonempty-PROXY", failed: true });
			continue;
		}

		const traces = readTracesFromDir(conditionDir);
		const predictions = readPredictionsFromDir(conditionDir);
		let resolvedSet: Set<string> | undefined;
		let resolvedSource: ResolvedSource = "patch-nonempty-PROXY";
		if (config.score) {
			// Unique per-condition run-id → scoped report → no cross-condition union.
			const runId = conditionRunId(condition, Math.floor(Date.now() / 1000));
			resolvedSet = runEvaluate(conditionDir, runId);
			// resolvedSet is undefined on no-report/parse-miss/crash → unscored proxy;
			// a (possibly empty) Set means the eval really scored this condition.
			resolvedSource = resolvedSet !== undefined ? "evaluate-patches.sh" : "patch-nonempty-PROXY";
		}
		meta.set(key, { resolvedSource, failed: false });
		const runs = buildConditionRuns({ condition, model: config.model, traces, predictions, resolvedSet });
		allRuns.push(...runs);
	}

	const conditionStats = perConditionStats(allRuns, PRICING_TABLE, meta);
	// Conditions that failed contribute no runs, so perConditionStats won't emit
	// them — append explicit failed rows so the manifest records the exclusion.
	for (const slug of failedSlugs) {
		const cond = conditions.find((c) => c.slug === slug);
		if (cond && !conditionStats.some((s) => s.prose === cond.prose && s.compression === cond.compression)) {
			conditionStats.push({
				prose: cond.prose,
				compression: cond.compression,
				passRate: 0,
				n: 0,
				medianCostPerResolved: null,
				nResolvedTasks: 0,
				resolvedSource: "patch-nonempty-PROXY",
				failed: true,
			});
		}
	}

	const proseEffectByCompression = buildProseEffectBlocks(
		allRuns,
		config.prose,
		config.compression,
		PRICING_TABLE,
		() => mulberry32(0xc0ffee),
	);
	const compressionEffectByProse = buildCompressionEffectBlocks(
		allRuns,
		config.prose,
		config.compression,
		PRICING_TABLE,
		() => mulberry32(0xfacade),
	);

	const manifest = assembleManifest({
		gitSha: gitSha(),
		provider: config.provider,
		model: config.model,
		seeds: config.seeds,
		scoreRequested: config.score,
		acceptanceCriteria: { maxQualityDropPp: 3, minCostSavingPct: 15 },
		conditions: conditionStats,
		proseEffectByCompression,
		compressionEffectByProse,
	});

	writeFileSync(join(config.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
	writeFileSync(join(config.outputDir, "runs.csv"), runsToCsv(allRuns, PRICING_TABLE));

	log("");
	log("=== Done ===");
	log(`Manifest: ${join(config.outputDir, "manifest.json")}`);
	log(`Runs CSV: ${join(config.outputDir, "runs.csv")}`);
	if (manifest.scored === false) {
		log("UNSCORED: resolved is a patch-nonempty WEAK proxy (scored:false). Re-run with --score for real resolved.");
	} else if (manifest.scored === "mixed") {
		log(
			`MIXED scoring: ${manifest.proxyConditions.length} condition(s) fell back to the patch-nonempty proxy (scored:"mixed").`,
		);
	}
	if (manifest.failedConditions.length > 0) {
		log(`FAILED conditions excluded from aggregates: ${failedSlugs.join(", ")}`);
	}
}

// Only run main when executed directly (not when imported by tests).
const isDirect = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isDirect) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
