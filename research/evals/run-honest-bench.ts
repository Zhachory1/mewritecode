#!/usr/bin/env npx tsx
/**
 * Honest MicroBench Runner.
 *
 * Spawns caveman, claude, and codex as REAL child processes against the
 * 25-task microbench. Records token usage + cost + pass/fail per (tool, task).
 * Emits CSV + JSON. No SDK shortcuts. Matches the user-visible CLI path.
 *
 * Usage:
 *   npx tsx research/evals/run-honest-bench.ts [options]
 *   npx tsx research/evals/run-honest-bench.ts --dry-run
 *   npx tsx research/evals/run-honest-bench.ts --limit 1 --difficulty easy
 *   npx tsx research/evals/run-honest-bench.ts --tools caveman --limit 5
 *
 * Options:
 *   --tasks <dir>             Tasks directory (default: research/evals/microbench/tasks)
 *   --limit <n>               Cap N tasks
 *   --difficulty <e|m|h>      easy | medium | hard
 *   --language <py|ts>        python | typescript
 *   --tools <list>            comma-separated subset of caveman,claude,codex
 *   --caveman-bin <path>      caveman CLI binary (default: $CAVEMAN_BIN or node dist/cli.js)
 *   --caveman-provider <p>    default: openai-codex
 *   --caveman-model <m>       default: gpt-5.5
 *   --caveman-thinking <l>    default: high
 *   --timeout <sec>           per-task per-tool timeout (default: 300)
 *   --output <dir>            results dir (default: research/results)
 *   --dry-run                 list tasks + detected tools, do not run
 */

import { spawnSync, execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tool = "caveman" | "claude" | "codex";

interface MicroBenchTask {
	id: string;
	dir: string;
	difficulty: "easy" | "medium" | "hard";
	language: "python" | "typescript";
	prompt: string;
}

interface RunResult {
	tool: Tool;
	provider: string | null;
	model: string | null;
	task_id: string;
	difficulty: string;
	language: string;
	resolved: boolean;
	duration_ms: number;
	tokens_fresh: number | null;       // input + output (billable, no cache)
	tokens_input: number | null;
	tokens_output: number | null;
	tokens_cache_read: number | null;
	tokens_cache_write: number | null;
	cost_usd: number | null;
	config_fingerprint: string;
	error: string | null;
	raw_log_path: string;
}

interface CavemanConfig {
	bin: string;
	provider: string;
	model: string;
	thinking: string;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
	tasksDir: string;
	limit: number | null;
	difficulty: "easy" | "medium" | "hard" | null;
	language: "python" | "typescript" | null;
	tools: Tool[];
	caveman: CavemanConfig;
	timeout: number;
	outputDir: string;
	dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
	const repoRoot = resolve(__dirname, "../..");
	const defaultBin = process.env.CAVEMAN_BIN
		? process.env.CAVEMAN_BIN
		: `node ${join(repoRoot, "packages/coding-agent/dist/cli.js")}`;

	const args: Args = {
		tasksDir: join(repoRoot, "research/evals/microbench/tasks"),
		limit: null,
		difficulty: null,
		language: null,
		tools: ["caveman", "codex"],
		caveman: {
			bin: defaultBin,
			provider: "openai-codex",
			model: "gpt-5.5",
			thinking: "high",
		},
		timeout: 300,
		outputDir: join(repoRoot, "research/results"),
		dryRun: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const next = () => argv[++i];
		switch (flag) {
			case "--tasks":
				args.tasksDir = resolve(next());
				break;
			case "--limit":
				args.limit = Number(next());
				break;
			case "--difficulty": {
				const v = next();
				if (v === "e" || v === "easy") args.difficulty = "easy";
				else if (v === "m" || v === "medium") args.difficulty = "medium";
				else if (v === "h" || v === "hard") args.difficulty = "hard";
				else throw new Error(`unknown difficulty: ${v}`);
				break;
			}
			case "--language": {
				const v = next();
				if (v === "py" || v === "python") args.language = "python";
				else if (v === "ts" || v === "typescript") args.language = "typescript";
				else throw new Error(`unknown language: ${v}`);
				break;
			}
			case "--tools":
				args.tools = next().split(",").map((s) => s.trim()) as Tool[];
				break;
			case "--caveman-bin":
				args.caveman.bin = next();
				break;
			case "--caveman-provider":
				args.caveman.provider = next();
				break;
			case "--caveman-model":
				args.caveman.model = next();
				break;
			case "--caveman-thinking":
				args.caveman.thinking = next();
				break;
			case "--timeout":
				args.timeout = Number(next());
				break;
			case "--output":
				args.outputDir = resolve(next());
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
			default:
				throw new Error(`unknown flag: ${flag}`);
		}
	}
	return args;
}

function printHelp(): void {
	// biome-ignore lint/suspicious/noConsole: CLI tool
	console.log(readFileSync(__filename, "utf-8").split("\n").slice(2, 28).join("\n"));
}

// ---------------------------------------------------------------------------
// Task discovery
// ---------------------------------------------------------------------------

function loadTasks(tasksDir: string): MicroBenchTask[] {
	if (!existsSync(tasksDir)) {
		throw new Error(`tasks dir not found: ${tasksDir}`);
	}
	const tasks: MicroBenchTask[] = [];
	for (const name of readdirSync(tasksDir).sort()) {
		const dir = join(tasksDir, name);
		const promptPath = join(dir, "prompt.txt");
		const metaPath = join(dir, "meta.json");
		if (!existsSync(promptPath) || !existsSync(metaPath)) continue;
		const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
			difficulty: "easy" | "medium" | "hard";
			language: "python" | "typescript";
		};
		tasks.push({
			id: name,
			dir,
			difficulty: meta.difficulty,
			language: meta.language,
			prompt: readFileSync(promptPath, "utf-8").trim(),
		});
	}
	return tasks;
}

function filterTasks(tasks: MicroBenchTask[], args: Args): MicroBenchTask[] {
	let out = tasks;
	if (args.difficulty) out = out.filter((t) => t.difficulty === args.difficulty);
	if (args.language) out = out.filter((t) => t.language === args.language);
	if (args.limit !== null) out = out.slice(0, args.limit);
	return out;
}

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

interface ToolStatus {
	tool: Tool;
	available: boolean;
	path: string | null;
}

function detectTools(tools: Tool[], caveman: CavemanConfig): ToolStatus[] {
	const out: ToolStatus[] = [];
	for (const tool of tools) {
		if (tool === "caveman") {
			const bin = caveman.bin.split(/\s+/)[0];
			out.push({
				tool,
				available: bin === "node" ? true : existsCommand(bin),
				path: caveman.bin,
			});
		} else {
			const path = which(tool);
			out.push({ tool, available: !!path, path });
		}
	}
	return out;
}

function which(cmd: string): string | null {
	const res = spawnSync("which", [cmd], { encoding: "utf-8" });
	if (res.status === 0) return res.stdout.trim();
	return null;
}

function existsCommand(cmd: string): boolean {
	if (cmd.startsWith("/") || cmd.startsWith("./")) return existsSync(cmd);
	return !!which(cmd);
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function prepareWorkspace(task: MicroBenchTask): string {
	const tmp = mkdtempSync(join(tmpdir(), `honest-bench-${task.id}-`));
	const setupDir = join(task.dir, "setup");
	if (existsSync(setupDir)) {
		cpSync(setupDir, tmp, { recursive: true });
	}
	return tmp;
}

function verifyWorkspace(task: MicroBenchTask, workDir: string): boolean {
	const verify = join(task.dir, "verify.sh");
	if (!existsSync(verify)) return true;
	try {
		execSync(`bash "${verify}"`, { cwd: workDir, timeout: 30_000, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

interface ToolRun {
	stdout: string;
	stderr: string;
	durationMs: number;
	tokens_input: number | null;
	tokens_output: number | null;
	tokens_cache_read: number | null;
	tokens_cache_write: number | null;
	cost_usd: number | null;
	error: string | null;
}

function runCaveman(prompt: string, cwd: string, cfg: CavemanConfig, timeoutSec: number): ToolRun {
	const binParts = cfg.bin.split(/\s+/);
	const cmd = binParts[0];
	const args = [
		...binParts.slice(1),
		"-p",
		prompt,
		"--mode",
		"json",
		"--provider",
		cfg.provider,
		"--model",
		cfg.model,
		"--thinking",
		cfg.thinking,
	];
	const start = Date.now();
	const res = spawnSync(cmd, args, {
		cwd,
		timeout: timeoutSec * 1000,
		encoding: "utf-8",
		maxBuffer: 50 * 1024 * 1024,
		env: { ...process.env, CI: "1" },
	});
	const durationMs = Date.now() - start;

	let ti = 0, to = 0, tcr = 0, tcw = 0, cost = 0;
	let saw = false;
	for (const line of (res.stdout ?? "").split("\n")) {
		if (!line.trim()) continue;
		try {
			const ev = JSON.parse(line);
			if (
				(ev.type === "message_end" || ev.type === "assistant" || ev.type === "session.end") &&
				(ev.message?.role === "assistant" || ev.type === "session.end")
			) {
				const usage = ev.message?.usage ?? ev.usage;
				if (usage) {
					ti += usage.input ?? usage.input_tokens ?? 0;
					to += usage.output ?? usage.output_tokens ?? 0;
					tcr += usage.cacheRead ?? usage.cache_read_input_tokens ?? 0;
					tcw += usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0;
					saw = true;
					const c =
						usage.cost?.total ??
						ev.message?.cost?.total ??
						ev.cost?.total_cost_usd ??
						ev.cost?.total;
					if (typeof c === "number") cost += c;
				}
			}
		} catch {
			/* not JSON, ignore */
		}
	}

	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		durationMs,
		tokens_input: saw ? ti : null,
		tokens_output: saw ? to : null,
		tokens_cache_read: saw ? tcr : null,
		tokens_cache_write: saw ? tcw : null,
		cost_usd: cost > 0 ? cost : null,
		error: res.error ? String(res.error) : res.status !== 0 ? `exit ${res.status}` : null,
	};
}

function runClaude(prompt: string, cwd: string, timeoutSec: number): ToolRun {
	const start = Date.now();
	const res = spawnSync(
		"claude",
		["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"],
		{
			cwd,
			timeout: timeoutSec * 1000,
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024,
			env: { ...process.env, CI: "1" },
		},
	);
	const durationMs = Date.now() - start;

	let ti: number | null = null;
	let to: number | null = null;
	let tcr: number | null = null;
	let tcw: number | null = null;
	let cost: number | null = null;
	try {
		const summary = JSON.parse((res.stdout ?? "").trim());
		cost = summary.total_cost_usd ?? summary.cost_usd ?? null;
		const u = summary.usage ?? summary;
		ti = u.input_tokens ?? null;
		to = u.output_tokens ?? null;
		tcr = u.cache_read_input_tokens ?? null;
		tcw = u.cache_creation_input_tokens ?? null;
	} catch {
		/* claude may emit non-JSON on error */
	}

	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		durationMs,
		tokens_input: ti,
		tokens_output: to,
		tokens_cache_read: tcr,
		tokens_cache_write: tcw,
		cost_usd: cost,
		error: res.error ? String(res.error) : res.status !== 0 ? `exit ${res.status}` : null,
	};
}

function runCodex(prompt: string, cwd: string, timeoutSec: number): ToolRun {
	const start = Date.now();
	const res = spawnSync(
		"codex",
		["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", prompt],
		{
			cwd,
			timeout: timeoutSec * 1000,
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024,
			env: { ...process.env, CI: "1" },
		},
	);
	const durationMs = Date.now() - start;

	const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
	let ti: number | null = null;
	let to: number | null = null;
	const inOutRe = /tokens(?:_used)?\s*[:=]?\s*\{?\s*input[:=\s]+(\d+)[\s,]+output[:=\s]+(\d+)/i;
	const inOut = combined.match(inOutRe);
	if (inOut) {
		ti = Number(inOut[1]);
		to = Number(inOut[2]);
	} else {
		const totalRe = /tokens\s+used\s*\n?\s*([\d,]+)/i;
		const totalMatch = combined.match(totalRe);
		if (totalMatch) {
			const total = Number(totalMatch[1].replace(/,/g, ""));
			ti = total;
			to = 0;
		}
	}
	let cost: number | null = null;
	const costRe = /cost[:=\s$]*([\d.]+)/i;
	const cm = combined.match(costRe);
	if (cm) cost = Number(cm[1]);

	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		durationMs,
		tokens_input: ti,
		tokens_output: to,
		tokens_cache_read: null,
		tokens_cache_write: null,
		cost_usd: cost,
		error: res.error ? String(res.error) : res.status !== 0 ? `exit ${res.status}` : null,
	};
}

// ---------------------------------------------------------------------------
// CSV + JSON writers
// ---------------------------------------------------------------------------

const CSV_HEADER = [
	"tool",
	"provider",
	"model",
	"task_id",
	"difficulty",
	"language",
	"resolved",
	"duration_ms",
	"tokens_fresh",
	"tokens_input",
	"tokens_output",
	"tokens_cache_read",
	"tokens_cache_write",
	"cost_usd",
	"config_fingerprint",
	"error",
].join(",");

function readCavemanFingerprint(): string {
	try {
		const home = process.env.HOME ?? "";
		const settingsPath = join(home, ".cave/agent/settings.json");
		if (!existsSync(settingsPath)) return "rtk=?,cave-mode=?,tool-compression=?,ml=?";
		const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const cm = s.caveMode ?? {};
		const rtkOn = s.rtk?.enabled ?? true;
		return `rtk=${rtkOn ? "on" : "off"},cave-mode=${cm.enabled === false ? "off" : cm.intensity ?? "full"},tool-compression=${cm.toolCompression === false ? "off" : "on"},ml=${cm.mlCompression ? "on" : "off"}`;
	} catch {
		return "rtk=?,cave-mode=?,tool-compression=?,ml=?";
	}
}

function fingerprintFor(tool: Tool, args: Args): string {
	if (tool === "caveman") {
		return `${readCavemanFingerprint()},model=${args.caveman.model},thinking=${args.caveman.thinking}`;
	}
	if (tool === "codex") return "sandbox=workspace-write,model=gpt-5.5";
	if (tool === "claude") return "skip-permissions=true";
	return "";
}

function csvRow(r: RunResult): string {
	const cells = [
		r.tool,
		r.provider ?? "",
		r.model ?? "",
		r.task_id,
		r.difficulty,
		r.language,
		String(r.resolved),
		String(r.duration_ms),
		r.tokens_fresh ?? "",
		r.tokens_input ?? "",
		r.tokens_output ?? "",
		r.tokens_cache_read ?? "",
		r.tokens_cache_write ?? "",
		r.cost_usd ?? "",
		JSON.stringify(r.config_fingerprint),
		r.error ? JSON.stringify(r.error) : "",
	];
	return cells.join(",");
}

interface Aggregate {
	tool: Tool;
	tasks: number;
	resolved: number;
	rate: number;
	tokens_total: number;
	cost_total: number;
}

function aggregate(results: RunResult[]): Record<Tool, Aggregate> {
	const out = {} as Record<Tool, Aggregate>;
	for (const r of results) {
		if (!out[r.tool]) {
			out[r.tool] = { tool: r.tool, tasks: 0, resolved: 0, rate: 0, tokens_total: 0, cost_total: 0 };
		}
		const a = out[r.tool];
		a.tasks++;
		if (r.resolved) a.resolved++;
		a.tokens_total += (r.tokens_input ?? 0) + (r.tokens_output ?? 0);
		a.cost_total += r.cost_usd ?? 0;
	}
	for (const a of Object.values(out)) a.rate = a.tasks ? a.resolved / a.tasks : 0;
	return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const allTasks = loadTasks(args.tasksDir);
	const tasks = filterTasks(allTasks, args);
	const detected = detectTools(args.tools, args.caveman);
	const activeTools = detected.filter((d) => d.available).map((d) => d.tool);

	// biome-ignore lint/suspicious/noConsole: CLI tool
	const log = (s: string) => console.log(s);
	log(`Honest MicroBench — ${tasks.length}/${allTasks.length} tasks`);
	for (const d of detected) {
		log(`  ${d.available ? "✓" : "✗"} ${d.tool.padEnd(8)} ${d.path ?? "(not in PATH)"}`);
	}
	log(`  caveman config: provider=${args.caveman.provider} model=${args.caveman.model} thinking=${args.caveman.thinking}`);

	if (args.dryRun) {
		log("\nDry run. Tasks:");
		for (const t of tasks) log(`  - ${t.id} [${t.difficulty}/${t.language}]`);
		return;
	}

	if (activeTools.length === 0) {
		log("No active tools. Aborting.");
		process.exit(2);
	}

	const date = new Date().toISOString().slice(0, 10);
	const runDir = join(args.outputDir, `honest-bench-${date}`);
	mkdirSync(runDir, { recursive: true });
	const csvPath = join(args.outputDir, `honest-bench-${date}.csv`);
	const jsonPath = join(args.outputDir, `honest-bench-${date}.json`);
	writeFileSync(csvPath, `${CSV_HEADER}\n`);

	const results: RunResult[] = [];

	for (const task of tasks) {
		log(`\n[${task.id}] ${task.difficulty}/${task.language}`);
		for (const tool of activeTools) {
			const workDir = prepareWorkspace(task);
			const logPath = join(runDir, tool, `${task.id}.log`);
			mkdirSync(join(runDir, tool), { recursive: true });
			let run: ToolRun;
			try {
				if (tool === "caveman") run = runCaveman(task.prompt, workDir, args.caveman, args.timeout);
				else if (tool === "claude") run = runClaude(task.prompt, workDir, args.timeout);
				else run = runCodex(task.prompt, workDir, args.timeout);
			} catch (e) {
				run = {
					stdout: "",
					stderr: String(e),
					durationMs: 0,
					tokens_input: null,
					tokens_output: null,
					tokens_cache_read: null,
					tokens_cache_write: null,
					cost_usd: null,
					error: String(e),
				};
			}
			writeFileSync(logPath, `=== STDOUT ===\n${run.stdout}\n\n=== STDERR ===\n${run.stderr}\n`);
			const resolved = verifyWorkspace(task, workDir);
			const fresh =
				run.tokens_input !== null || run.tokens_output !== null
					? (run.tokens_input ?? 0) + (run.tokens_output ?? 0)
					: null;
			const result: RunResult = {
				tool,
				provider: tool === "caveman" ? args.caveman.provider : null,
				model: tool === "caveman" ? args.caveman.model : tool === "codex" ? "gpt-5.5" : null,
				task_id: task.id,
				difficulty: task.difficulty,
				language: task.language,
				resolved,
				duration_ms: run.durationMs,
				tokens_fresh: fresh,
				tokens_input: run.tokens_input,
				tokens_output: run.tokens_output,
				tokens_cache_read: run.tokens_cache_read,
				tokens_cache_write: run.tokens_cache_write,
				cost_usd: run.cost_usd,
				config_fingerprint: fingerprintFor(tool, args),
				error: run.error,
				raw_log_path: logPath,
			};
			results.push(result);
			writeFileSync(csvPath, `${csvRow(result)}\n`, { flag: "a" });
			rmSync(workDir, { recursive: true, force: true });
			log(
				`  ${tool.padEnd(8)} ${resolved ? "✓" : "✗"} ${run.durationMs}ms  fresh=${
					fresh ?? "?"
				} cache_r=${run.tokens_cache_read ?? "?"} cost=$${(run.cost_usd ?? 0).toFixed(4)}`,
			);
		}
	}

	const agg = aggregate(results);
	const summary = {
		date,
		tools: activeTools,
		tasks: tasks.length,
		config: {
			caveman: {
				provider: args.caveman.provider,
				model: args.caveman.model,
				thinking: args.caveman.thinking,
			},
		},
		aggregate: agg,
		results,
	};
	writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

	log("\n=== Aggregate ===");
	for (const a of Object.values(agg)) {
		log(
			`  ${a.tool.padEnd(8)} ${a.resolved}/${a.tasks} resolved (${(a.rate * 100).toFixed(0)}%)  tokens=${a.tokens_total}  cost=$${a.cost_total.toFixed(2)}`,
		);
	}
	log(`\nCSV : ${csvPath}`);
	log(`JSON: ${jsonPath}`);
	log(`Logs: ${runDir}/`);
}

main().catch((err) => {
	// biome-ignore lint/suspicious/noConsole: CLI tool
	console.error(err);
	process.exit(1);
});
