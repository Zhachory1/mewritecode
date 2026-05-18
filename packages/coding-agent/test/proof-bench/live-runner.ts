/**
 * Live runner — spawns the real `cave` binary across the 4-config ablation
 * grid on the pinned microbench-lite-v1 task set.
 *
 * Per (config, task, seed) triple:
 *   1. mkdtemp a fresh CAVE_CODING_AGENT_DIR
 *   2. write settings.json with the config's caveMode block
 *   3. copy task/setup/ into a fresh working dir
 *   4. spawn `caveman -p <prompt> --output json --model <model>`
 *   5. parse `message_end` events for token usage
 *   6. run task/verify.sh → pass/fail
 *   7. save session.jsonl for replay + audit
 *
 * Emits LiveRow[] matching the results.json schema. Enforces a cumulative
 * cost cap — aborts the run when spent exceeds the cap.
 */

import { execSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_CONFIGS, type LiveConfig, type LiveConfigId, renderSettingsJson } from "./ablation-matrix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF_BENCH_ROOT = __dirname;
const REPO_ROOT = join(PROOF_BENCH_ROOT, "..", "..", "..", "..");

export interface LiveRunnerOptions {
	tasks: Array<{ id: string; source: string }>;
	configs?: readonly LiveConfig[];
	seeds?: number[];
	model?: string;
	caveBin?: string;
	maxCostUsd?: number;
	perTaskTimeoutMs?: number;
	/** Where to persist session.jsonl files for later replay/audit. Defaults to a fresh tmp dir. */
	sessionsOutDir?: string;
	onProgress?: (msg: string) => void;
}

export interface LiveRow {
	config: LiveConfigId;
	taskId: string;
	seed: number;
	passed: boolean;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	turns: number;
	cost: number;
	durationMs: number;
	sessionPath?: string;
}

export interface LiveRunnerResult {
	rows: LiveRow[];
	totalCostUsd: number;
	abortedOnCostCap: boolean;
	sessionsOutDir: string;
}

interface TaskFiles {
	id: string;
	source: string;
	prompt: string;
	setupDir: string | null;
	verifyScript: string | null;
}

function resolveTask(repoRoot: string, task: { id: string; source: string }): TaskFiles {
	const base = join(repoRoot, task.source);
	const promptPath = join(base, "prompt.txt");
	if (!existsSync(promptPath)) throw new Error(`Missing prompt.txt: ${promptPath}`);
	const setupDir = existsSync(join(base, "setup")) ? join(base, "setup") : null;
	const verifyScript = existsSync(join(base, "verify.sh")) ? join(base, "verify.sh") : null;
	return {
		id: task.id,
		source: task.source,
		prompt: readFileSync(promptPath, "utf-8").trim(),
		setupDir,
		verifyScript,
	};
}

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function setupTaskDir(task: TaskFiles, dest: string): void {
	if (task.setupDir) cpSync(task.setupDir, dest, { recursive: true });
}

function verifyTask(task: TaskFiles, cwd: string): boolean {
	if (!task.verifyScript) return true;
	try {
		execSync(`bash "${task.verifyScript}"`, { cwd, timeout: 10000, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function writeSettingsJson(configDir: string, config: LiveConfig): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "settings.json"), renderSettingsJson(config), "utf-8");
}

interface ParsedUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

function parseCaveJsonOutput(output: string): ParsedUsage {
	let input = 0;
	let outputTokens = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let turns = 0;
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as {
				type?: string;
				message?: {
					role?: string;
					usage?: {
						input?: number;
						output?: number;
						cacheRead?: number;
						cacheWrite?: number;
						cost?: { total?: number };
					};
				};
			};
			if (event.type === "message_end" && event.message?.role === "assistant") {
				turns += 1;
				const u = event.message.usage;
				if (u) {
					input += u.input ?? 0;
					outputTokens += u.output ?? 0;
					cacheRead += u.cacheRead ?? 0;
					cacheWrite += u.cacheWrite ?? 0;
					cost += u.cost?.total ?? 0;
				}
			}
		} catch {
			// Non-JSON line, skip (cave prints some non-event logs to stdout)
		}
	}
	return { input, output: outputTokens, cacheRead, cacheWrite, cost, turns };
}

function locateSessionFile(configDir: string): string | null {
	// CAVE_CODING_AGENT_DIR points at the equivalent of ~/.cave/agent, so sessions
	// land in <dir>/sessions/<slug>/<session>.jsonl — no extra /agent/ segment.
	const sessionsBase = join(configDir, "sessions");
	if (!existsSync(sessionsBase)) return null;
	const candidates: Array<{ path: string; mtime: number }> = [];
	const walk = (d: string) => {
		let names: string[];
		try {
			names = readdirSync(d);
		} catch {
			return;
		}
		for (const name of names) {
			const p = join(d, name);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(p);
			} catch {
				continue;
			}
			if (st.isDirectory()) walk(p);
			else if (p.endsWith(".jsonl")) candidates.push({ path: p, mtime: st.mtimeMs });
		}
	};
	walk(sessionsBase);
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.mtime - a.mtime);
	return candidates[0].path;
}

/**
 * Parse CAVE_BIN-style executable strings into argv.
 * Accepts both `"cave"` and `"node /path/to/cli.js"` so pre-built installs and
 * in-repo dist/ builds both work. Whitespace-split is sufficient — we never
 * pass user-controlled content through this channel.
 */
function splitCaveBin(spec: string): { executable: string; leadingArgs: string[] } {
	const parts = spec.trim().split(/\s+/);
	return { executable: parts[0], leadingArgs: parts.slice(1) };
}

function runOne(task: TaskFiles, config: LiveConfig, seed: number, opts: LiveRunnerOptions): LiveRow {
	const caveBinSpec = opts.caveBin ?? process.env.CAVE_BIN ?? "cave";
	const { executable, leadingArgs } = splitCaveBin(caveBinSpec);
	const model = opts.model ?? "claude-haiku-4-5";
	const workDir = createTempDir(`proof-work-${task.id}-${config.id}-s${seed}-`);
	const agentDir = createTempDir(`proof-agent-${task.id}-${config.id}-s${seed}-`);
	writeSettingsJson(agentDir, config);
	setupTaskDir(task, workDir);

	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		CAVE_CODING_AGENT_DIR: agentDir,
		CI: "1",
		// Stabilize: disable network-y startup ops that vary token counts
		PI_OFFLINE: "1",
	};

	// Use argv-array form via spawnSync: no shell, so `$`, backticks, `\` in
	// `task.prompt` are passed through literally instead of being expanded by
	// the host shell. This closes a command-injection hazard that
	// `execSync(args.join(" "))` would have opened.
	const caveArgs = [
		...leadingArgs,
		"-p",
		task.prompt,
		"--mode",
		"json",
		"--model",
		model,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
	];

	const start = Date.now();
	const result = spawnSync(executable, caveArgs, {
		cwd: workDir,
		timeout: opts.perTaskTimeoutMs ?? 180_000,
		env,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 20 * 1024 * 1024,
		encoding: "utf-8",
	});
	const stdout = result.stdout ?? "";
	const durationMs = Date.now() - start;

	const usage = parseCaveJsonOutput(stdout);
	const passed = verifyTask(task, workDir);

	// Persist the session file for downstream audit/replay.
	let sessionPath: string | undefined;
	try {
		const src = locateSessionFile(agentDir);
		if (src && opts.sessionsOutDir) {
			mkdirSync(opts.sessionsOutDir, { recursive: true });
			const dst = join(opts.sessionsOutDir, `${task.id}__${config.id}__s${seed}__${basename(src)}`);
			cpSync(src, dst);
			sessionPath = dst;
		} else if (src) {
			sessionPath = src;
		}
	} catch {
		// non-fatal
	}

	// Always clean up work and agent dirs — we've already copied the session
	// file out when one existed. Keeping agentDir around would leak tmp on
	// every failed run.
	try {
		rmSync(workDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
	try {
		rmSync(agentDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}

	return {
		config: config.id,
		taskId: task.id,
		seed,
		passed,
		tokens: {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			total: usage.input + usage.output,
		},
		turns: usage.turns,
		cost: usage.cost,
		durationMs,
		sessionPath,
	};
}

export function runLive(opts: LiveRunnerOptions): LiveRunnerResult {
	const configs = opts.configs ?? LIVE_CONFIGS;
	const seeds = opts.seeds ?? [0, 1];
	const sessionsOutDir = opts.sessionsOutDir ?? createTempDir("proof-sessions-");
	const tasks = opts.tasks.map((t) => resolveTask(REPO_ROOT, t));
	const rows: LiveRow[] = [];
	let totalCost = 0;
	let aborted = false;

	const progress = opts.onProgress ?? (() => {});

	outer: for (const config of configs) {
		for (const task of tasks) {
			for (const seed of seeds) {
				if (opts.maxCostUsd !== undefined && totalCost >= opts.maxCostUsd) {
					progress(`cost cap reached ($${totalCost.toFixed(2)} ≥ $${opts.maxCostUsd}); aborting`);
					aborted = true;
					break outer;
				}
				progress(`→ ${config.id} / ${task.id} / seed=${seed}`);
				const row = runOne(task, config, seed, { ...opts, sessionsOutDir });
				rows.push(row);
				totalCost += row.cost;
				progress(
					`  ${row.passed ? "PASS" : "FAIL"} in=${row.tokens.input} out=${row.tokens.output} cr=${row.tokens.cacheRead} $${row.cost.toFixed(4)} (${row.durationMs}ms)`,
				);
			}
		}
	}

	return { rows, totalCostUsd: totalCost, abortedOnCostCap: aborted, sessionsOutDir };
}

export function loadMicrobenchLite(jsonlPath: string): Array<{ id: string; source: string }> {
	const content = readFileSync(jsonlPath, "utf-8");
	const out: Array<{ id: string; source: string }> = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		const parsed = JSON.parse(line) as { id: string; source: string };
		out.push({ id: parsed.id, source: parsed.source });
	}
	return out;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const taskListPath = args[0] ?? join(PROOF_BENCH_ROOT, "datasets", "microbench-lite-v1.jsonl");
	const outPath = args[1] ?? join(PROOF_BENCH_ROOT, "live-rows.json");
	const maxCostStr = process.env.PROOF_MAX_COST_USD ?? "5";
	const maxCostUsd = Number.parseFloat(maxCostStr);

	const tasks = loadMicrobenchLite(taskListPath);
	const result = runLive({
		tasks,
		maxCostUsd,
		onProgress: (msg) => process.stderr.write(`${msg}\n`),
	});
	writeFileSync(outPath, JSON.stringify(result, null, 2));
	process.stdout.write(`Wrote ${outPath}\n`);
	process.stdout.write(`Total cost: $${result.totalCostUsd.toFixed(4)}\n`);
	if (result.abortedOnCostCap) {
		process.stderr.write("ABORTED: cost cap reached\n");
		process.exit(3);
	}
}
