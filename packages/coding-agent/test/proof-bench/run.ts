/**
 * Top-level orchestrator — wires together layer-isolation, replay, live-runner,
 * cave-output-eval, token-auditor, preflight, reporter.
 *
 * Invoked by scripts/run-all.sh and scripts/run-quick.sh. Exits non-zero if
 * preflight fails (publication blocked) or if the cost cap aborts the run.
 *
 * Modes:
 *   --smoke    : 3 tasks × {A-baseline, F-cave-full} × 1 seed, skip output-eval
 *   (default)  : full suite per manifest.json
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_CONFIGS, type LiveConfig } from "./ablation-matrix.js";
import { runOutputEval } from "./cave-output-eval.js";
import { runLayerIsolation } from "./layer-isolation.js";
import { loadMicrobenchLite, runLive } from "./live-runner.js";
import { runPreflight } from "./preflight.js";
import { replayAllWithBaseline } from "./replay-runner.js";
import { emitResults, hashDatasets, hashManifest, type ReporterInput } from "./reporter.js";
import { auditLiveRun } from "./token-auditor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_BENCH = __dirname;
const REPO_ROOT = join(PROOF_BENCH, "..", "..", "..", "..");

interface OrchestratorOptions {
	smoke: boolean;
	skipOutputEval: boolean;
	skipAudit: boolean;
	skipLive: boolean;
	maxCostUsd: number;
	outDir: string;
}

function parseArgs(argv: string[]): OrchestratorOptions {
	const opts: OrchestratorOptions = {
		smoke: false,
		skipOutputEval: false,
		skipAudit: false,
		skipLive: false,
		maxCostUsd: 5,
		outDir: join(PROOF_BENCH, "results", new Date().toISOString().replace(/[:.]/g, "-")),
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--smoke") opts.smoke = true;
		else if (a === "--skip-output-eval") opts.skipOutputEval = true;
		else if (a === "--skip-audit") opts.skipAudit = true;
		else if (a === "--no-live") opts.skipLive = true;
		else if (a === "--max-cost" && i + 1 < argv.length) opts.maxCostUsd = Number.parseFloat(argv[++i]);
		else if (a === "--out-dir" && i + 1 < argv.length) opts.outDir = argv[++i];
	}
	return opts;
}

function gitHeadSha(): string {
	try {
		return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
	} catch {
		return "unknown";
	}
}

function splitCaveBin(spec: string): { executable: string; leadingArgs: string[] } {
	const parts = spec.trim().split(/\s+/);
	return { executable: parts[0], leadingArgs: parts.slice(1) };
}

/**
 * Version of the actually-spawned `cave` binary. If that differs from the
 * repo package.json, publishing the repo version would mislead reviewers —
 * so we ask the binary itself. Falls back to the repo pkg only if the spawn
 * fails (e.g. cave not on PATH).
 */
function caveVersion(): string {
	try {
		const { executable, leadingArgs } = splitCaveBin(process.env.CAVE_BIN ?? "cave");
		const r = spawnSync(executable, [...leadingArgs, "--version"], { encoding: "utf-8", timeout: 10_000 });
		const out = (r.stdout ?? "").trim();
		if (out) return out.split("\n")[0];
	} catch {
		/* fall through */
	}
	try {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "coding-agent", "package.json"), "utf-8"));
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const stderr = (s: string) => process.stderr.write(s + "\n");

	stderr(`## CAVE Compression Proof — ${opts.smoke ? "SMOKE" : "FULL"} run`);
	stderr(`outDir=${opts.outDir}`);
	mkdirSync(opts.outDir, { recursive: true });

	const manifestPath = join(PROOF_BENCH, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	const manifestHash = hashManifest(manifestPath);
	const datasetHash = hashDatasets(join(PROOF_BENCH, "datasets"));
	const codeSha = gitHeadSha();
	const ranAt = new Date().toISOString();

	// Inject dataset hash + code SHA into an in-memory manifest copy for preflight
	const effectiveManifest = { ...manifest, datasetHash, codeSha };

	// 1) Layer isolation (free, offline)
	stderr(`\n[1/6] layer-isolation — corpus-tools-v1 fixtures`);
	const layerIsolation = runLayerIsolation();
	stderr(`  → ${layerIsolation.length} rows across ${new Set(layerIsolation.map((r) => r.fixture)).size} fixtures`);

	// 2) Live runner
	stderr(`\n[2/6] live-runner — real \`cave\` binary`);
	const allTasks = loadMicrobenchLite(join(PROOF_BENCH, "datasets", "microbench-lite-v1.jsonl"));
	const tasks = opts.smoke ? allTasks.slice(0, 3) : allTasks;
	const configs: readonly LiveConfig[] = opts.smoke
		? LIVE_CONFIGS.filter((c) => c.id === "A-baseline" || c.id === "F-cave-full")
		: LIVE_CONFIGS;
	const seeds = opts.smoke ? [0] : [0, 1];
	const live: {
		rows: Awaited<ReturnType<typeof runLive>>["rows"];
		totalCostUsd: number;
		abortedOnCostCap: boolean;
		sessionsOutDir: string;
	} = opts.skipLive
		? { rows: [], totalCostUsd: 0, abortedOnCostCap: false, sessionsOutDir: join(opts.outDir, "sessions") }
		: runLive({
				tasks,
				configs,
				seeds,
				maxCostUsd: opts.maxCostUsd,
				sessionsOutDir: join(opts.outDir, "sessions"),
				onProgress: stderr,
			});
	stderr(
		`  → ${live.rows.length} rows; $${live.totalCostUsd.toFixed(4)} spent${live.abortedOnCostCap ? " (ABORTED ON COST CAP)" : ""}${opts.skipLive ? " (--no-live)" : ""}`,
	);

	// 3) Replay (free, uses sessions captured in step 2)
	stderr(`\n[3/6] replay-runner — re-pipe captured sessions`);
	const sessionPaths = live.rows
		.map((r) => r.sessionPath)
		.filter((p): p is string => typeof p === "string" && existsSync(p));
	const uniqueSessions = Array.from(new Set(sessionPaths));
	const { rows: replay, baselines: replayBaselines } =
		uniqueSessions.length > 0 ? replayAllWithBaseline(uniqueSessions) : { rows: [], baselines: [] };
	stderr(
		`  → ${replay.length} replay rows + ${replayBaselines.length} baselines across ${uniqueSessions.length} sessions`,
	);

	// 4) Token audit (free, live rows only)
	stderr(`\n[4/6] token-auditor — count_tokens recount`);
	const apiKey = process.env.ANTHROPIC_API_KEY;
	const liveWithAudit: ReporterInput["live"] = [];
	if (!opts.skipAudit && apiKey) {
		for (const row of live.rows) {
			try {
				const transcript = row.sessionPath ? readSessionTranscript(row.sessionPath) : { messages: [] };
				const audit = await auditLiveRun({
					messages: transcript.messages,
					// system prompt is intentionally omitted — see readSessionTranscript.
					cliReportedInputTokens: row.tokens.input,
					model: manifest.model,
					apiKey,
				});
				liveWithAudit.push({
					...row,
					audit: {
						recount: audit.recountInputTokens,
						deltaPct: audit.deltaPct,
						withinTolerance: audit.withinTolerance,
						tolerancePct: audit.tolerancePct,
					},
				});
				stderr(
					`  ${row.config}/${row.taskId}[s${row.seed}]: cli=${row.tokens.input} recount=${audit.recountInputTokens} Δ=${audit.deltaPct.toFixed(2)}%`,
				);
			} catch (e) {
				stderr(`  audit failed for ${row.config}/${row.taskId}[s${row.seed}]: ${(e as Error).message}`);
				liveWithAudit.push(row);
			}
		}
	} else {
		stderr(`  → skipped (${opts.skipAudit ? "--skip-audit" : "no ANTHROPIC_API_KEY"})`);
		for (const r of live.rows) liveWithAudit.push(r);
	}

	// 5) Caveman-output eval (costs tokens)
	stderr(`\n[5/6] cave-output-eval — generation-side savings`);
	let outputEval: Awaited<ReturnType<typeof runOutputEval>>["rows"] = [];
	let outputEvalCost = 0;
	if (!opts.skipOutputEval && !opts.smoke && !opts.skipLive && apiKey) {
		const result = await runOutputEval({
			apiKey,
			model: manifest.model,
			onProgress: stderr,
		});
		outputEval = result.rows;
		outputEvalCost = result.totalCost;
		stderr(`  → ${outputEval.length} rows; $${outputEvalCost.toFixed(4)} spent`);
	} else {
		stderr(
			`  → skipped (${opts.smoke ? "smoke mode" : opts.skipOutputEval ? "--skip-output-eval" : "no ANTHROPIC_API_KEY"})`,
		);
	}

	const totalCost = live.totalCostUsd + outputEvalCost;

	// 6) Preflight (needs the full ReporterInput shape for schema validation)
	stderr(`\n[6/6] preflight — publication gates`);
	const schemaPath = join(PROOF_BENCH, "schema", "results.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
	const reporterInputDraft: ReporterInput = {
		schemaVersion: "1.0.0",
		manifestHash,
		codeSha,
		datasetHash,
		ranAt,
		costUsd: totalCost,
		costCapUsd: manifest.costCapUsd,
		platform: { os: platform(), arch: arch(), node: process.version, caveVersion: caveVersion() },
		live: liveWithAudit,
		replay,
		replayBaselines,
		layerIsolation,
		outputEval,
		preflight: { passed: false, checks: [] }, // placeholder; overwritten after preflight runs
	};
	const preflight = runPreflight({
		input: {
			results: {
				manifestHash,
				codeSha,
				datasetHash,
				costUsd: totalCost,
				costCapUsd: manifest.costCapUsd,
				live: liveWithAudit,
				outputEval,
			},
			manifest: effectiveManifest,
		},
		datasetsDir: join(PROOF_BENCH, "datasets"),
		repoRoot: REPO_ROOT,
		schema,
		schemaTarget: reporterInputDraft,
	});
	for (const c of preflight.checks) stderr(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);

	// Emit (re-use the draft and stitch in the real preflight result)
	const reporterInput: ReporterInput = { ...reporterInputDraft, preflight };
	const emitted = emitResults(reporterInput, opts.outDir);
	stderr(`\nWrote:`);
	stderr(`  ${emitted.jsonPath}`);
	stderr(`  ${join(opts.outDir, "results.md")}`);
	stderr(`  ${emitted.waterfallPath}`);

	// Host info for the audit log
	writeFileSync(
		join(opts.outDir, "host.json"),
		JSON.stringify(
			{ hostname: hostname(), platform: platform(), arch: arch(), node: process.version, ranAt },
			null,
			2,
		),
	);

	if (!preflight.passed) {
		stderr(`\nPREFLIGHT FAILED — results are not publication-ready.`);
		process.exit(1);
	}
	if (live.abortedOnCostCap) {
		stderr(`\nRun aborted on cost cap.`);
		process.exit(3);
	}
	stderr(`\n✓ Preflight passed — results are publication-ready.`);
}

/**
 * Extract the user/assistant message bodies from a caveman session .jsonl for
 * the token audit. We deliberately do NOT try to reconstruct the system
 * prompt here: cave assembles it dynamically (with skills, extensions, cave
 * mode injections) and the fully-expanded string is not stored in the
 * session file. The audit therefore compares body-only recount against
 * body-only `input_tokens`, not the whole payload.
 *
 * This is an acknowledged reduced-scope audit — the preflight tolerance of
 * 2% still catches serious parsing drift, and the reporter footnotes it.
 */
function readSessionTranscript(path: string): { messages: Array<{ role: "user" | "assistant"; content: string }> } {
	const content = readFileSync(path, "utf-8");
	const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line) as {
				message?: { role?: string; content?: Array<{ type: string; text?: string }> };
			};
			const msg = e.message;
			if (!msg) continue;
			if (msg.role !== "user" && msg.role !== "assistant") continue;
			const text = (msg.content ?? [])
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => b.text as string)
				.join("\n");
			if (text) messages.push({ role: msg.role, content: text });
		} catch {
			/* non-JSON line */
		}
	}
	return { messages };
}

main().catch((e) => {
	process.stderr.write(`\nORCHESTRATOR FAILED: ${String(e)}\n`);
	if (e instanceof Error && e.stack) process.stderr.write(e.stack + "\n");
	process.exit(2);
});
