#!/usr/bin/env npx tsx
/**
 * SWE-bench Verified runner for Cave CLI.
 *
 * Uses the Cave SDK (createAgentSession) to run the full multi-turn agent loop
 * per instance. This ensures proper tool calling (read/edit/bash/grep) instead
 * of the model generating text-only responses.
 *
 * HANG GUARD (#32): the agent-loop idle-timeout (DEFAULT_STREAM_IDLE_TIMEOUT_MS,
 * see packages/agent/src/agent-loop.ts) did NOT protect this SDK `session.prompt`
 * path — a real run froze on a model turn that stalled WITHOUT tripping the
 * mid-stream idle watchdog (0% CPU, 27 min, no output), and the cost-based --cap
 * never fires on a stalled request (no cost accrues), so one hung instance freezes
 * the whole condition forever. The `--instance-timeout` wall-clock bound below is
 * the belt: it aborts the in-flight turn (session.abort) and returns an errored
 * InstanceResult so the per-instance loop moves on.
 *
 * Usage:
 *   npx tsx research/evals/run-swebench.ts [options]
 *
 * Options:
 *   --limit <n>            Max instances to run (default: all)
 *   --instance-id <id>     Run a single instance by ID
 *   --repos <r1,r2>        Filter to specific repos
 *   --cap <dollars>        Per-instance cost cap (default: $5, env: CAVE_BENCH_INSTANCE_CAP_DOLLARS)
 *   --instance-timeout <s> Hard per-instance WALL-CLOCK timeout in seconds (default: 900,
 *                          env: CAVE_BENCH_INSTANCE_TIMEOUT_SEC). On timeout the in-flight
 *                          turn is aborted and the instance is recorded as an error so the
 *                          run continues (belt for the idle-timeout gap, #32). 900s is well
 *                          above the longest legit run observed (~580s) to avoid false aborts.
 *   --output <path>        Output dir (default: research/results)
 *   --provider <name>      LLM provider (default: openai-codex)
 *   --model <pattern>      Model pattern (default: gpt-5.4)
 *   --thinking <level>     Thinking level (default: high)
 *   --cave <level>         Caveman PROSE level: off|lite|full|ultra (default: ultra — current behavior)
 *   --compression <on|off> Tool-output compression knob, INDEPENDENT of --cave
 *                          (default: follow settings/current — no behavior change when omitted).
 *                          The ablation runner (#33) sets this to isolate the compression effect.
 *   --sample <mode>        How --limit selects instances: first|diverse (default: first).
 *                          `first`   = the first N rows (current/back-compat behavior; the
 *                                      Verified set is repo-sorted so first-N skews to one repo,
 *                                      e.g. all astropy).
 *                          `diverse` = round-robin across DISTINCT repos so --limit N spreads
 *                                      across as many repos as possible (one per repo, then a
 *                                      second from each, …). Order within a repo is preserved.
 *   --dataset <path>       Local JSONL file instead of HuggingFace
 *   --dry-run              Load dataset and print instance IDs without running
 */

import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	aggregateBench,
	type BenchInstance,
	loadSweBenchFromFile,
	loadSweBenchVerified,
	runBench,
} from "../../packages/agent/src/bench/index.js";
import type { ThinkingLevel } from "../../packages/agent/src/index.js";
import { getModel } from "../../packages/ai/src/models.js";
import { createAgentSession } from "../../packages/coding-agent/src/core/sdk.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { SettingsManager } from "../../packages/coding-agent/src/core/settings-manager.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

type CaveLevel = "off" | "lite" | "full" | "ultra";
export type SampleMode = "first" | "diverse";

interface RunConfig {
	limit?: number;
	instanceId?: string;
	repos?: string[];
	capDollars: number;
	// Hard per-instance WALL-CLOCK timeout in seconds. The cost-based `capDollars`
	// does NOT protect against a STALLED model turn (a hung request accrues no cost
	// so the cap never trips), and the agent-loop idle-timeout did not fire on this
	// SDK `session.prompt` path either (#32) — so this wall-clock bound is the belt
	// that aborts a frozen instance and lets the run continue.
	instanceTimeoutSec: number;
	outputDir: string;
	provider: string;
	model: string;
	thinking: string;
	cave: CaveLevel;
	// Tool-output compression override, INDEPENDENT of `cave` (prose). undefined =
	// follow settings/current (no behavior change). true/false = force via the
	// session-level knob setCaveModeSessionToolCompression. The ablation runner
	// (#33) uses this to vary compression while holding prose fixed.
	compression?: boolean;
	// How --limit selects instances. "first" = first-N (back-compat). "diverse" =
	// round-robin across distinct repos so --limit spreads over repos.
	sample: SampleMode;
	datasetPath?: string;
	dryRun: boolean;
}

/** Minimal shape needed for diverse sampling — repo is the only key that matters. */
interface RepoTagged {
	repo: string;
}

/**
 * Round-robin sample across DISTINCT repos, preserving each repo's internal order
 * and first-seen repo order. With `limit`, take one instance from each repo in
 * turn (round 1), then a second from each that still has more (round 2), … until
 * `limit` is reached. This spreads a small --limit over as many repos as possible
 * instead of taking the first-N (which, on the repo-sorted Verified set, is all
 * one repo). PURE: no I/O, deterministic given input order.
 */
export function diverseSample<T extends RepoTagged>(instances: T[], limit?: number): T[] {
	// Bucket by repo, preserving first-seen repo order and within-repo order.
	const order: string[] = [];
	const byRepo = new Map<string, T[]>();
	for (const inst of instances) {
		let bucket = byRepo.get(inst.repo);
		if (!bucket) {
			bucket = [];
			byRepo.set(inst.repo, bucket);
			order.push(inst.repo);
		}
		bucket.push(inst);
	}

	const out: T[] = [];
	const cap = limit && limit > 0 ? limit : instances.length;
	let added = true;
	const cursor = new Map<string, number>();
	while (added && out.length < cap) {
		added = false;
		for (const repo of order) {
			if (out.length >= cap) break;
			const bucket = byRepo.get(repo)!;
			const idx = cursor.get(repo) ?? 0;
			if (idx < bucket.length) {
				out.push(bucket[idx]);
				cursor.set(repo, idx + 1);
				added = true;
			}
		}
	}
	return out;
}

function parseRunArgs(): RunConfig {
	const args = process.argv.slice(2);
	const config: RunConfig = {
		capDollars: Number(process.env.CAVE_BENCH_INSTANCE_CAP_DOLLARS) || 5,
		instanceTimeoutSec: Number(process.env.CAVE_BENCH_INSTANCE_TIMEOUT_SEC) || 900,
		outputDir: resolve("research/results"),
		provider: "openai-codex",
		model: "gpt-5.4",
		thinking: "high",
		// Default preserves prior behavior (enabled + ultra) so existing runs are unchanged.
		cave: "ultra",
		// Default "first" preserves prior first-N --limit behavior (back-compat).
		sample: "first",
		dryRun: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--limit":
				config.limit = Number(args[++i]);
				break;
			case "--instance-id":
				config.instanceId = args[++i];
				break;
			case "--repos":
				config.repos = args[++i].split(",");
				break;
			case "--cap":
				config.capDollars = Number(args[++i]);
				break;
			case "--instance-timeout": {
				const v = Number(args[++i]);
				if (!Number.isFinite(v) || v <= 0) {
					console.error(`Invalid --instance-timeout value: ${v} (expected a positive number of seconds)`);
					process.exit(1);
				}
				config.instanceTimeoutSec = v;
				break;
			}
			case "--output":
				config.outputDir = resolve(args[++i]);
				break;
			case "--provider":
				config.provider = args[++i];
				break;
			case "--model":
				config.model = args[++i];
				break;
			case "--thinking":
				config.thinking = args[++i];
				break;
			case "--cave": {
				const level = args[++i];
				if (level !== "off" && level !== "lite" && level !== "full" && level !== "ultra") {
					console.error(`Invalid --cave level: ${level} (expected off|lite|full|ultra)`);
					process.exit(1);
				}
				config.cave = level;
				break;
			}
			case "--compression": {
				const v = args[++i];
				if (v !== "on" && v !== "off") {
					console.error(`Invalid --compression value: ${v} (expected on|off)`);
					process.exit(1);
				}
				config.compression = v === "on";
				break;
			}
			case "--sample": {
				const v = args[++i];
				if (v !== "first" && v !== "diverse") {
					console.error(`Invalid --sample value: ${v} (expected first|diverse)`);
					process.exit(1);
				}
				config.sample = v;
				break;
			}
			case "--dataset":
				config.datasetPath = resolve(args[++i]);
				break;
			case "--dry-run":
				config.dryRun = true;
				break;
			default:
				console.error(`Unknown arg: ${arg}`);
				process.exit(1);
		}
	}
	return config;
}

// ---------------------------------------------------------------------------
// Repo checkout
// ---------------------------------------------------------------------------

function cloneAndCheckout(repo: string, baseCommit: string, workDir: string): void {
	const repoUrl = `https://github.com/${repo}.git`;
	log(`  Cloning ${repo} @ ${baseCommit.slice(0, 8)}...`);

	execSync(`git clone --no-checkout --filter=blob:none "${repoUrl}" "${workDir}"`, {
		stdio: "pipe",
		timeout: 120_000,
	});
	execSync(`git checkout ${baseCommit}`, {
		cwd: workDir,
		stdio: "pipe",
		timeout: 30_000,
	});
}

// ---------------------------------------------------------------------------
// SWE-bench prompt
// ---------------------------------------------------------------------------

const SWEBENCH_SYSTEM_ADDENDUM = [
	"You are solving a GitHub issue. You MUST use tools to fix the issue:",
	"1. Use `read` and `grep` to explore the codebase and find relevant files",
	"2. Use `edit` to apply fixes directly to source files",
	"3. Every response MUST include at least one tool call",
	"Do NOT describe fixes in text — implement them by editing files.",
	"Make minimal, targeted changes. Do not add tests. Do not commit.",
].join("\n");

function buildPrompt(instance: BenchInstance): string {
	return ["Fix the following GitHub issue in this repository.\n", instance.problem_statement].join("\n");
}

// ---------------------------------------------------------------------------
// Run caveman session on a single instance
// ---------------------------------------------------------------------------

interface InstanceResult {
	patch: string;
	durationMs: number;
	cost: number;
	toolCalls: number;
	// All four token classes. On error every field is null (not 0) so failed
	// runs are excludable from accounting rather than silently counted as zero.
	tokens: {
		input: number | null;
		output: number | null;
		cacheRead: number | null;
		cacheWrite: number | null;
	};
	error?: string;
}

/**
 * Build an errored InstanceResult: empty patch, ALL four token fields null (not 0)
 * so a failed run is excludable from accounting rather than counted as a
 * zero-token success, and the supplied error message. `durationMs` is caller-
 * supplied (the wall-clock spent before the failure).
 */
export function erroredInstanceResult(error: string, durationMs: number): InstanceResult {
	return {
		patch: "",
		durationMs,
		cost: 0,
		toolCalls: 0,
		tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
		error,
	};
}

/**
 * Bound `promise` with a WALL-CLOCK timeout. PURE/testable race helper — no I/O,
 * no AgentSession needed.
 *
 * If `promise` settles first, its value/rejection is passed straight through and
 * the timer is cleared. If `timeoutMs` elapses first, `onTimeout()` is invoked
 * (the caller wires this to a REAL cancel — `session.abort()` — so the orphaned
 * model turn is actually aborted, not just left running) and the returned promise
 * resolves to `timeoutValue`. The original `promise`'s later settlement is
 * ignored (its rejection is swallowed so it can't surface as an unhandled
 * rejection after we've already moved on).
 *
 * This is the belt for #32: the agent-loop idle-timeout did not fire on the SDK
 * `session.prompt` path, so a stalled turn would hang forever; this wall-clock
 * bound guarantees the per-instance loop makes progress.
 *
 * @param promise the in-flight work to bound (e.g. session.prompt(...))
 * @param timeoutMs wall-clock budget in milliseconds
 * @param onTimeout invoked exactly once if the timeout wins (real cancel hook)
 * @param timeoutValue value to resolve with on timeout (e.g. an errored result)
 */
export async function withInstanceTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: () => void,
	timeoutValue: T,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				onTimeout();
			} catch {
				// A failing cancel hook must not mask the timeout — we still resolve
				// to the errored value so the run continues.
			}
			resolve(timeoutValue);
		}, timeoutMs);
		// Avoid keeping the event loop alive purely for this timer.
		if (typeof timer.unref === "function") timer.unref();

		promise.then(
			(v) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(v);
			},
			(err) => {
				if (settled) {
					// Timeout already won; swallow the late rejection from the orphaned
					// (now-aborted) turn so it doesn't surface as unhandled.
					return;
				}
				settled = true;
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

async function runCaveOnInstance(instance: BenchInstance, workDir: string, config: RunConfig): Promise<InstanceResult> {
	const start = Date.now();

	try {
		// Resolve model
		const model = getModel(config.provider as any, config.model as any);
		if (!model) {
			throw new Error(`Model not found: ${config.provider}/${config.model}`);
		}

		// Configure caveman mode for the chosen level. For lite/full/ultra we
		// enable cave mode + tool/ML compression at the requested intensity. For
		// `off` we disable cave mode entirely so BOTH the prompt block AND the
		// tool-output compression gate (afterToolCall reads getCaveModeEnabled())
		// are off — a true off, not just an intensity reset.
		const settingsManager = SettingsManager.create(workDir);
		if (config.cave === "off") {
			settingsManager.setCaveModeEnabled(false);
			settingsManager.setCaveModeToolCompression(false);
			settingsManager.setCaveModeMLCompression(false);
		} else {
			settingsManager.setCaveModeEnabled(true);
			settingsManager.setCaveModeIntensity(config.cave);
			settingsManager.setCaveModeToolCompression(true);
			settingsManager.setCaveModeMLCompression(true);
		}

		// Create agent session using the SDK
		const { session } = await createAgentSession({
			cwd: workDir,
			model,
			thinkingLevel: config.thinking as ThinkingLevel,
			settingsManager,
			sessionManager: SessionManager.inMemory(workDir),
		});

		// Wait for runtime to initialize (constructor fires _buildRuntime async)
		await new Promise((r) => setTimeout(r, 100));

		// For `off`, also disable cave mode at the session level so the rendered
		// system prompt carries no cave-mode block (setCaveModeSessionDisabled sets
		// _sessionCaveModeDisabled, which forces caveModeEnabled=false in
		// _rebuildSystemPrompt — verified in agent-session.ts).
		if (config.cave === "off") {
			session.setCaveModeSessionDisabled();
		}

		// Tool-output COMPRESSION override (#33), INDEPENDENT of prose (--cave).
		// When --compression is omitted (undefined), leave the knob alone so behavior
		// matches the settings configured above (no change). When provided, force it
		// at the session level so the ablation can vary compression while holding
		// prose fixed. Note: the compression gate still ANDs with getCaveModeEnabled(),
		// so `--cave off` (which sets settings.enabled=false) keeps compression off
		// regardless — by design, "off" means caveman fully off.
		if (config.compression !== undefined) {
			session.setCaveModeSessionToolCompression(config.compression);
		}

		// Append SWE-bench-specific system prompt
		const basePrompt = session.systemPrompt;
		session.agent.state.systemPrompt = `${basePrompt}\n\n${SWEBENCH_SYSTEM_ADDENDUM}`;

		// Run the agent loop — this triggers multi-turn tool calling.
		//
		// HANG GUARD (#32): bound the turn with a hard WALL-CLOCK timeout. The
		// agent-loop idle-timeout did not fire on this path and the cost --cap can't
		// trip on a stalled (cost-free) request, so without this a frozen turn hangs
		// the whole condition. On timeout we call session.abort() — a REAL cancel:
		// it aborts the active run's AbortController (propagating to the in-flight
		// model stream) and awaits idle — then return an errored result so the loop
		// advances to the next instance. The TIMEOUT_SENTINEL distinguishes "timed
		// out" from "prompt resolved" without depending on prompt()'s return value.
		log("  Running agent...");
		const TIMEOUT_SENTINEL = Symbol("instance-timeout");
		const timeoutMs = config.instanceTimeoutSec * 1000;
		// Map prompt()'s Promise<void> to Promise<undefined> so the race result type
		// is `undefined | sentinel` (avoids a confusing `void` in a union).
		const promptDone: Promise<undefined> = session
			.prompt(buildPrompt(instance), { expandPromptTemplates: false })
			.then(() => undefined);
		const raced = await withInstanceTimeout<undefined | typeof TIMEOUT_SENTINEL>(
			promptDone,
			timeoutMs,
			() => {
				// Real cancel of the orphaned turn. Fire-and-forget: abort() returns a
				// promise (waits for idle) but we don't block the timeout path on it.
				log(`  TIMEOUT after ${config.instanceTimeoutSec}s — aborting in-flight turn`);
				void session.abort();
			},
			TIMEOUT_SENTINEL,
		);
		if (raced === TIMEOUT_SENTINEL) {
			// Per-instance SKIP recorded as an error — must NOT throw out of the loop
			// (the orchestrator excludes errored instances honestly).
			return erroredInstanceResult(`instance timeout after ${config.instanceTimeoutSec}s`, Date.now() - start);
		}

		// Get stats
		const stats = session.getSessionStats();

		// Capture git diff
		let patch = "";
		try {
			patch = execSync("git diff", { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }).toString();
		} catch (e) {
			log(`  WARNING: git diff failed: ${e}`);
		}

		return {
			patch,
			durationMs: Date.now() - start,
			cost: stats.cost,
			toolCalls: stats.toolCalls,
			tokens: {
				input: stats.tokens.input,
				output: stats.tokens.output,
				cacheRead: stats.tokens.cacheRead,
				cacheWrite: stats.tokens.cacheWrite,
			},
		};
	} catch (error) {
		return erroredInstanceResult(error instanceof Error ? error.message : String(error), Date.now() - start);
	}
}

// ---------------------------------------------------------------------------
// SWE-bench prediction format
// ---------------------------------------------------------------------------

interface SweBenchPrediction {
	instance_id: string;
	model_name_or_path: string;
	model_patch: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const config = parseRunArgs();

	log("=== SWE-bench Verified Runner for Cave CLI (SDK mode) ===");
	log(
		`Provider: ${config.provider} | Model: ${config.model} | Thinking: ${config.thinking} | Cap: $${config.capDollars}/instance | Timeout: ${config.instanceTimeoutSec}s/instance`,
	);
	log(
		config.cave === "off"
			? `Caveman prose: off (cave mode disabled)`
			: `Caveman prose: ${config.cave} + tool + ML compression`,
	);
	if (config.compression !== undefined) {
		log(`Compression override: ${config.compression ? "on" : "off"} (independent of --cave prose)`);
	}

	// Load dataset. For "diverse" sampling we must NOT push --limit into the loader
	// (it would first-N truncate before we can spread across repos), so we load the
	// full repo-filtered set and apply diverseSample afterward. For "first" (and a
	// single --instance-id) the loader applies the limit as before (back-compat).
	const loaderLimit =
		config.instanceId || config.sample === "diverse" ? undefined : config.limit;
	log(`Loading SWE-bench Verified dataset... (sample: ${config.sample})`);
	let instances: BenchInstance[];
	if (config.datasetPath) {
		instances = await loadSweBenchFromFile(config.datasetPath, {
			repos: config.repos,
			limit: loaderLimit,
		});
	} else {
		instances = await loadSweBenchVerified({
			repos: config.repos,
			limit: loaderLimit,
		});
	}

	// Filter to single instance if specified
	if (config.instanceId) {
		instances = instances.filter((i) => i.id === config.instanceId);
		if (instances.length === 0) {
			console.error(`Instance not found: ${config.instanceId}`);
			process.exit(1);
		}
	} else if (config.sample === "diverse") {
		// Round-robin across distinct repos so --limit N spreads over repos.
		instances = diverseSample(instances, config.limit);
	}

	log(`Loaded ${instances.length} instances`);

	if (config.dryRun) {
		log("DRY RUN — instance IDs:");
		for (const inst of instances) {
			console.log(`  ${inst.id} (${inst.repo})`);
		}
		process.exit(0);
	}

	// Ensure output directories
	mkdirSync(config.outputDir, { recursive: true });
	const date = new Date().toISOString().slice(0, 10);
	const predictionsPath = join(config.outputDir, "predictions.jsonl");
	const resultsPath = join(config.outputDir, `swebench-${date}.json`);
	const tracesDir = join(config.outputDir, "traces");
	mkdirSync(tracesDir, { recursive: true });

	// Clear previous predictions file
	writeFileSync(predictionsPath, "");

	const modelLabel = `cave:${config.provider}:${config.model}:${config.thinking}`;

	// Run bench using the adapter
	log(`Starting benchmark run...`);
	log("");

	let totalCost = 0;
	const results = await runBench(instances, {
		perInstanceCapDollars: config.capDollars,
		runInstance: async (instance) => {
			const idx = instances.indexOf(instance) + 1;
			log(`[${idx}/${instances.length}] ${instance.id}`);

			// Create temp working directory
			const workDir = join(tmpdir(), `cave-bench-${instance.id}-${Date.now()}`);
			mkdirSync(workDir, { recursive: true });

			try {
				// Clone and checkout
				cloneAndCheckout(instance.repo, instance.base_commit, workDir);

				// Run cave agent session
				const result = await runCaveOnInstance(instance, workDir, config);
				totalCost += result.cost;

				// Write prediction
				const prediction: SweBenchPrediction = {
					instance_id: instance.id,
					model_name_or_path: modelLabel,
					model_patch: result.patch,
				};
				appendFileSync(predictionsPath, `${JSON.stringify(prediction)}\n`);

				// Save trace
				const traceFile = join(tracesDir, `${instance.id}.json`);
				writeFileSync(
					traceFile,
					JSON.stringify(
						{
							instance_id: instance.id,
							duration_ms: result.durationMs,
							cost: result.cost,
							tool_calls: result.toolCalls,
							tokens: result.tokens,
							patch_lines: result.patch.split("\n").length,
							error: result.error,
						},
						null,
						2,
					),
				);

				const hasPatch = result.patch.trim().length > 0;
				log(
					`  ${hasPatch ? "PATCH" : "NO_PATCH"} | ${(result.durationMs / 1000).toFixed(1)}s | $${result.cost.toFixed(3)} | ${result.toolCalls} tools${result.error ? ` | ERROR: ${result.error}` : ""}`,
				);

				return {
					resolved: hasPatch,
					attempts: 1,
					dollarsSpent: result.cost,
					durationMs: result.durationMs,
					traces: [traceFile],
				};
			} finally {
				if (!process.env.CAVE_BENCH_KEEP_WORKDIRS) {
					try {
						rmSync(workDir, { recursive: true, force: true });
					} catch {}
				} else {
					log(`  Keeping workdir: ${workDir}`);
				}
			}
		},
	});

	// Aggregate and write results
	const agg = aggregateBench(results);
	const report = {
		date,
		model: modelLabel,
		config: {
			provider: config.provider,
			model: config.model,
			thinking: config.thinking,
			capDollars: config.capDollars,
			cave: config.cave,
			// `compression` reflects the EFFECTIVE override when one was supplied via
			// --compression (the #33 independent knob), else the cave-derived default.
			compression:
				config.compression !== undefined
					? config.compression
						? "on"
						: "off"
					: config.cave === "off"
						? "off"
						: `${config.cave}+tool+ml`,
		},
		aggregate: agg,
		results,
	};

	writeFileSync(resultsPath, JSON.stringify(report, null, 2));

	// Also write to nightly slot
	const nightlyPath = join(config.outputDir, "nightly", `${date}.json`);
	mkdirSync(join(config.outputDir, "nightly"), { recursive: true });
	writeFileSync(nightlyPath, JSON.stringify(report, null, 2));

	log("");
	log("=== Results ===");
	log(`Instances: ${agg.total}`);
	log(`Patches produced: ${agg.resolved}/${agg.total} (${(agg.resolvedRate * 100).toFixed(1)}%)`);
	log(`Cost cap failures: ${agg.capFailures}`);
	log(`Total cost: $${totalCost.toFixed(2)}`);
	log("");
	log(`Predictions: ${predictionsPath}`);
	log(`Results:     ${resultsPath}`);
	log(`Traces:      ${tracesDir}/`);
	log("");
	log("Next step: evaluate patches with SWE-bench harness:");
	log(`  bash research/evals/evaluate-patches.sh ${predictionsPath}`);
}

// Only run main when executed directly (not when imported by tests, which pull in
// the pure diverseSample helper without spawning the paid benchmark).
const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
