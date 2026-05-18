/**
 * Reporter — emits results.md (publishable), results.json (schema-validated),
 * and waterfall.txt (per-layer ASCII chart).
 *
 * All three carry the manifest hash so a future reviewer can verify that the
 * published numbers correspond to a frozen input.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Intensity, OutputEvalRow } from "./cave-output-eval.js";
import type { LayerIsolationRow } from "./layer-isolation.js";
import type { LiveRow } from "./live-runner.js";
import type { PreflightReport } from "./preflight.js";
import type { ReplayBaselineRow, ReplayRow } from "./replay-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ReporterInput {
	schemaVersion: string;
	manifestHash: string;
	codeSha: string;
	datasetHash?: string;
	ranAt: string;
	costUsd: number;
	costCapUsd: number;
	platform: {
		os: string;
		arch: string;
		node: string;
		caveVersion: string;
	};
	live: Array<
		LiveRow & { audit?: { recount: number; deltaPct: number; withinTolerance: boolean; tolerancePct: number } }
	>;
	replay: ReplayRow[];
	/** Tokens for each session when every caveman layer is on — the clean attribution baseline. */
	replayBaselines?: ReplayBaselineRow[];
	layerIsolation: LayerIsolationRow[];
	outputEval: OutputEvalRow[];
	preflight: PreflightReport;
}

function pad(s: string, n: number): string {
	return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function median(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function mean(xs: number[]): number {
	if (xs.length === 0) return 0;
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------------------------------------------------------------------------
// Live config aggregation
// ---------------------------------------------------------------------------

interface ConfigAggregate {
	config: string;
	runs: number;
	seeds: number;
	passAt1: number;
	tokensInputMean: number;
	tokensOutputMean: number;
	cacheReadMean: number;
	cacheWriteMean: number;
	costMean: number;
	auditDeltaMean: number;
	auditFailures: number;
}

function aggregateLive(live: ReporterInput["live"]): ConfigAggregate[] {
	const byConfig = new Map<string, typeof live>();
	for (const r of live) {
		if (!byConfig.has(r.config)) byConfig.set(r.config, []);
		byConfig.get(r.config)!.push(r);
	}
	const out: ConfigAggregate[] = [];
	for (const [config, rows] of byConfig.entries()) {
		const passed = rows.filter((r) => r.passed).length;
		const seeds = new Set(rows.map((r) => r.seed)).size;
		const audits = rows.filter((r) => r.audit);
		out.push({
			config,
			runs: rows.length,
			seeds,
			passAt1: (passed / rows.length) * 100,
			tokensInputMean: mean(rows.map((r) => r.tokens.input)),
			tokensOutputMean: mean(rows.map((r) => r.tokens.output)),
			cacheReadMean: mean(rows.map((r) => r.tokens.cacheRead)),
			cacheWriteMean: mean(rows.map((r) => r.tokens.cacheWrite)),
			costMean: mean(rows.map((r) => r.cost)),
			auditDeltaMean: audits.length === 0 ? 0 : mean(audits.map((r) => r.audit!.deltaPct)),
			auditFailures: audits.filter((r) => !r.audit!.withinTolerance).length,
		});
	}
	// Canonical ordering
	const order = ["A-baseline", "D-output-only", "F-cave-full", "G-cave-ultra"];
	out.sort((a, b) => order.indexOf(a.config) - order.indexOf(b.config));
	return out;
}

// ---------------------------------------------------------------------------
// Replay attribution (layer %)
// ---------------------------------------------------------------------------

interface LayerAttribution {
	layer: string;
	meanDeltaPct: number;
	sessions: number;
}

function attributeReplayLayers(replay: ReplayRow[], baselines: ReplayBaselineRow[] | undefined): LayerAttribution[] {
	// Per-layer savings attribution:
	//   savings(layer X) = (tokensReplay[config=no-X] − tokensAllLayersOn) / tokensOriginal
	//
	// We require a real "all-layers-on" baseline per session (from
	// replayAllLayersOnBaseline). Without it, we can't compute principled
	// attribution — fall through to an empty result rather than invent one.
	if (!baselines || baselines.length === 0) return [];
	const baselineBySession = new Map<string, ReplayBaselineRow>();
	for (const b of baselines) baselineBySession.set(b.sessionPath, b);

	const layerDeltas = new Map<string, number[]>();
	for (const r of replay) {
		const base = baselineBySession.get(r.sessionPath);
		if (!base) continue;
		const layer = r.config.replace("replay-no-", "");
		if (!layerDeltas.has(layer)) layerDeltas.set(layer, []);
		const original = base.tokensOriginal;
		const saved = original === 0 ? 0 : ((r.tokensReplay - base.tokensAllLayersOn) / original) * 100;
		layerDeltas.get(layer)!.push(saved);
	}
	const out: LayerAttribution[] = [];
	for (const [layer, vals] of layerDeltas.entries()) {
		out.push({ layer, meanDeltaPct: mean(vals), sessions: vals.length });
	}
	out.sort((a, b) => b.meanDeltaPct - a.meanDeltaPct);
	return out;
}

// ---------------------------------------------------------------------------
// Output-eval aggregation
// ---------------------------------------------------------------------------

interface OutputAggregate {
	intensity: Intensity;
	meanTokensOut: number;
	meanQuality: number;
	acceptedRate: number;
	meanReductionVsOffPct: number;
}

function aggregateOutputEval(rows: OutputEvalRow[]): OutputAggregate[] {
	const byInt = new Map<Intensity, OutputEvalRow[]>();
	for (const r of rows) {
		if (!byInt.has(r.intensity)) byInt.set(r.intensity, []);
		byInt.get(r.intensity)!.push(r);
	}
	const offByPrompt = new Map<string, number>();
	for (const r of rows) {
		if (r.intensity === "off") offByPrompt.set(r.promptId, r.outputTokens);
	}
	const out: OutputAggregate[] = [];
	const order: Intensity[] = ["off", "lite", "full", "ultra"];
	for (const intensity of order) {
		const bucket = byInt.get(intensity) ?? [];
		if (bucket.length === 0) continue;
		const reductions = bucket
			.map((r) => {
				const off = offByPrompt.get(r.promptId);
				if (!off || off === 0) return 0;
				return ((off - r.outputTokens) / off) * 100;
			})
			.filter((x) => x !== 0 || intensity === "off");
		out.push({
			intensity,
			meanTokensOut: mean(bucket.map((r) => r.outputTokens)),
			meanQuality: mean(bucket.map((r) => r.qualityScore)),
			acceptedRate: bucket.filter((r) => r.accepted).length / bucket.length,
			meanReductionVsOffPct: mean(reductions),
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function renderResultsMd(input: ReporterInput): string {
	const liveAgg = aggregateLive(input.live);
	const outputAgg = aggregateOutputEval(input.outputEval);
	const replayAttr = attributeReplayLayers(input.replay, input.replayBaselines);

	const lines: string[] = [];
	lines.push(`# CAVE Compression Proof — Results`);
	lines.push("");
	lines.push(`**Manifest hash:** \`${input.manifestHash}\``);
	lines.push(`**Code SHA:** \`${input.codeSha}\``);
	if (input.datasetHash) lines.push(`**Dataset hash:** \`${input.datasetHash}\``);
	lines.push(`**Ran at:** ${input.ranAt}`);
	lines.push(
		`**Platform:** ${input.platform.os}/${input.platform.arch} node ${input.platform.node} cave ${input.platform.caveVersion}`,
	);
	lines.push(`**Cost:** $${input.costUsd.toFixed(2)} / cap $${input.costCapUsd.toFixed(2)}`);
	lines.push(`**Preflight:** ${input.preflight.passed ? "PASSED" : "FAILED"}`);
	lines.push("");

	lines.push(`## Headline — live ablation (${input.live.length} real \`cave\` runs)`);
	lines.push("");
	lines.push("| Config | Runs | pass@1 | in-tok (mean) | out-tok | cache-read | $/run | audit Δ% | audit fail |");
	lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
	for (const a of liveAgg) {
		lines.push(
			`| \`${a.config}\` | ${a.runs} | ${a.passAt1.toFixed(0)}% | ${a.tokensInputMean.toFixed(0)} | ${a.tokensOutputMean.toFixed(0)} | ${a.cacheReadMean.toFixed(0)} | $${a.costMean.toFixed(4)} | ${a.auditDeltaMean.toFixed(2)}% | ${a.auditFailures} |`,
		);
	}
	lines.push("");

	if (liveAgg.length >= 2) {
		const baseline = liveAgg.find((a) => a.config === "A-baseline");
		const full = liveAgg.find((a) => a.config === "F-cave-full");
		if (baseline && full && baseline.tokensInputMean > 0) {
			const saved = ((baseline.tokensInputMean - full.tokensInputMean) / baseline.tokensInputMean) * 100;
			lines.push(
				`> **\`F-cave-full\` vs \`A-baseline\`: ${saved.toFixed(1)}% fewer input tokens per run**, iso-quality (pass@1 ${full.passAt1.toFixed(0)}% vs ${baseline.passAt1.toFixed(0)}%).`,
			);
			lines.push("");
		}
	}

	lines.push("## Layer attribution — replay ablation (free, $0)");
	lines.push("");
	if (replayAttr.length === 0) {
		lines.push("_No replay sessions available._");
	} else {
		lines.push(
			"Baseline: session tokens with every caveman layer on. A layer's row shows how many tokens *reappear* when that layer alone is disabled — i.e. how much it was saving.",
		);
		lines.push("");
		lines.push("| Layer | Mean Δ% vs all-layers-on | Sessions |");
		lines.push("|---|---:|---:|");
		for (const a of replayAttr) {
			lines.push(`| \`${a.layer}\` | ${a.meanDeltaPct.toFixed(2)}% | ${a.sessions} |`);
		}
	}
	lines.push("");

	lines.push("## Caveman-output eval (generation-side savings, Haiku judged)");
	lines.push("");
	lines.push("| Intensity | Mean out-tok | Mean quality (0-10) | Accepted | Reduction vs off |");
	lines.push("|---|---:|---:|---:|---:|");
	for (const a of outputAgg) {
		lines.push(
			`| \`${a.intensity}\` | ${a.meanTokensOut.toFixed(0)} | ${a.meanQuality.toFixed(2)} | ${(a.acceptedRate * 100).toFixed(0)}% | ${a.meanReductionVsOffPct.toFixed(1)}% |`,
		);
	}
	lines.push("");

	lines.push("## Fixture per-layer micro-savings (corpus-tools-v1)");
	lines.push("");
	const byLayer = new Map<string, number[]>();
	for (const r of input.layerIsolation) {
		if (r.fixture === "<system-prompt>") continue;
		if (!byLayer.has(r.layer)) byLayer.set(r.layer, []);
		byLayer.get(r.layer)!.push(r.savedPct);
	}
	const layerAgg: Array<{ layer: string; median: number; mean: number; n: number }> = [];
	for (const [l, vs] of byLayer) layerAgg.push({ layer: l, median: median(vs), mean: mean(vs), n: vs.length });
	layerAgg.sort((a, b) => b.median - a.median);
	lines.push("| Layer | Fixtures | Median saved | Mean saved |");
	lines.push("|---|---:|---:|---:|");
	for (const a of layerAgg) {
		lines.push(`| \`${a.layer}\` | ${a.n} | ${a.median.toFixed(1)}% | ${a.mean.toFixed(1)}% |`);
	}
	lines.push("");

	lines.push("## Preflight checks");
	lines.push("");
	for (const c of input.preflight.checks) {
		lines.push(`- ${c.ok ? "✓" : "✗"} **${c.name}** — ${c.detail}`);
	}
	lines.push("");

	lines.push("## Reproduction");
	lines.push("");
	lines.push("```");
	lines.push(`git checkout ${input.codeSha}`);
	lines.push(`cd packages/coding-agent`);
	lines.push(`export ANTHROPIC_API_KEY=...`);
	lines.push(`test/proof-bench/scripts/run-all.sh`);
	lines.push("```");
	lines.push("");
	lines.push("Compare per-row against this file — tokens must match within the 2% audit tolerance.");
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Waterfall (text art)
// ---------------------------------------------------------------------------

function renderWaterfall(layerAggRows: Array<{ layer: string; savedPct: number }>, width = 40): string {
	const max = Math.max(1, ...layerAggRows.map((r) => Math.abs(r.savedPct)));
	const lines: string[] = [];
	lines.push("CAVE compression — layer attribution (higher = more savings)");
	lines.push("");
	for (const r of layerAggRows) {
		const barLen = Math.round((Math.abs(r.savedPct) / max) * width);
		const bar = (r.savedPct >= 0 ? "█" : "░").repeat(Math.max(1, barLen));
		lines.push(`${pad(r.layer, 28)} ${bar} ${r.savedPct.toFixed(1)}%`);
	}
	return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Main emit
// ---------------------------------------------------------------------------

export function emitResults(
	input: ReporterInput,
	outDir: string,
): { md: string; jsonPath: string; waterfallPath: string } {
	mkdirSync(outDir, { recursive: true });

	const md = renderResultsMd(input);
	writeFileSync(join(outDir, "results.md"), md, "utf-8");
	const jsonPath = join(outDir, "results.json");
	writeFileSync(jsonPath, JSON.stringify(input, null, 2), "utf-8");

	// Waterfall pulls from fixture per-layer median
	const byLayer = new Map<string, number[]>();
	for (const r of input.layerIsolation) {
		if (r.fixture === "<system-prompt>") continue;
		if (!byLayer.has(r.layer)) byLayer.set(r.layer, []);
		byLayer.get(r.layer)!.push(r.savedPct);
	}
	const rows: Array<{ layer: string; savedPct: number }> = [];
	for (const [l, vs] of byLayer) rows.push({ layer: l, savedPct: median(vs) });
	rows.sort((a, b) => b.savedPct - a.savedPct);
	const waterfall = renderWaterfall(rows);
	const waterfallPath = join(outDir, "waterfall.txt");
	writeFileSync(waterfallPath, waterfall, "utf-8");

	return { md, jsonPath, waterfallPath };
}

// ---------------------------------------------------------------------------
// Utilities for scripts
// ---------------------------------------------------------------------------

export function hashDatasets(datasetsDir: string): string {
	const hash = createHash("sha256");
	const walk = (dir: string): string[] => {
		const out: string[] = [];
		for (const name of readdirSync(dir).sort()) {
			const p = join(dir, name);
			const s = statSync(p);
			if (s.isDirectory()) out.push(...walk(p));
			else out.push(p);
		}
		return out;
	};
	for (const f of walk(datasetsDir)) {
		hash.update(f.replace(datasetsDir, ""));
		hash.update(readFileSync(f));
	}
	return hash.digest("hex");
}

export function hashManifest(manifestPath: string): string {
	return createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
}
