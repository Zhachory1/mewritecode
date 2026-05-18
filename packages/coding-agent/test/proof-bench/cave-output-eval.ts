/**
 * Caveman-output eval — the single biggest measurement gap before this harness.
 *
 * Measures the *generation-side* savings of cave mode: how many output tokens
 * does the model spend under each intensity, and is quality preserved?
 *
 * Procedure per prompt × intensity:
 *   1. Spawn `caveman -p <prompt> --output json --cave-mode <intensity> --model <model>`
 *      with CAVE_CODING_AGENT_DIR set so settings are deterministic.
 *   2. Parse message_end → output token count.
 *   3. Score with Haiku as judge (rubric 0–10 across 3 axes, median of 2 runs).
 *   4. Accept the intensity only if `quality(intensity) ≥ quality(off) − gap`.
 *
 * Cost budget: 15 prompts × 4 intensities × 2 seeds = 120 gens + 120 judges
 * on Haiku ≈ $0.60.
 *
 * The judge is a separate `fetch` to Anthropic's messages endpoint (not the
 * cave binary) so we don't recursively drag the system under test into its
 * own grading.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaveModeSettings } from "../../src/core/settings-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Intensity = "off" | "lite" | "full" | "ultra";

export interface OutputPrompt {
	id: string;
	type: string;
	prompt: string;
}

export interface GenerationResult {
	promptId: string;
	intensity: Intensity;
	seed: number;
	outputText: string;
	outputTokens: number;
	cost: number;
}

export interface QualityJudgeScore {
	completeness: number;
	correctness: number;
	helpfulness: number;
	/** Mean across the three axes, clamped to [0, 10]. */
	overall: number;
	rationale: string;
}

export interface OutputEvalRow {
	promptId: string;
	intensity: Intensity;
	outputTokens: number;
	qualityScore: number;
	judgeRuns: number;
	accepted: boolean;
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";
const DEFAULT_JUDGE_RUNS = 2;
const DEFAULT_QUALITY_GAP = 1;

export function loadOutputPrompts(path?: string): OutputPrompt[] {
	const p = path ?? join(__dirname, "datasets", "corpus-prompts-v1.jsonl");
	const content = readFileSync(p, "utf-8");
	const out: OutputPrompt[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		out.push(JSON.parse(line) as OutputPrompt);
	}
	return out;
}

function intensityToCaveModeSettings(intensity: Intensity): CaveModeSettings {
	if (intensity === "off") {
		return { enabled: false, toolCompression: false, mlCompression: false };
	}
	return { enabled: true, intensity, toolCompression: false, mlCompression: false };
}

function makeAgentDir(intensity: Intensity, promptId: string, seed: number): string {
	const dir = mkdtempSync(join(tmpdir(), `proof-oeval-${promptId}-${intensity}-s${seed}-`));
	writeFileSync(
		join(dir, "settings.json"),
		JSON.stringify({ caveMode: intensityToCaveModeSettings(intensity) }, null, 2),
	);
	return dir;
}

function splitCaveBin(spec: string): { executable: string; leadingArgs: string[] } {
	const parts = spec.trim().split(/\s+/);
	return { executable: parts[0], leadingArgs: parts.slice(1) };
}

export function generateOne(
	prompt: OutputPrompt,
	intensity: Intensity,
	seed: number,
	caveBin?: string,
	model?: string,
): GenerationResult {
	const binSpec = caveBin ?? process.env.CAVE_BIN ?? "cave";
	const { executable, leadingArgs } = splitCaveBin(binSpec);
	const mdl = model ?? DEFAULT_MODEL;
	const agentDir = makeAgentDir(intensity, prompt.id, seed);
	const workDir = mkdtempSync(join(tmpdir(), `proof-oeval-work-${prompt.id}-${intensity}-s${seed}-`));

	const args = [
		...leadingArgs,
		"-p",
		prompt.prompt,
		"--mode",
		"json",
		"--model",
		mdl,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-tools",
	];
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		CAVE_CODING_AGENT_DIR: agentDir,
		CI: "1",
		PI_OFFLINE: "1",
	};

	// spawnSync with argv array — no shell, so `$`, backticks, `\` in the
	// prompt (corpus-prompts-v1 contains real backticks in markdown) are
	// passed through literally rather than triggering command substitution
	// on the host.
	const result = spawnSync(executable, args, {
		cwd: workDir,
		timeout: 90_000,
		env,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 10 * 1024 * 1024,
		encoding: "utf-8",
	});
	const stdout = result.stdout ?? "";

	let outputTokens = 0;
	let cost = 0;
	let outputText = "";
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as {
				type?: string;
				message?: {
					role?: string;
					content?: Array<{ type: string; text?: string }>;
					usage?: { output?: number; cost?: { total?: number } };
				};
			};
			if (event.type === "message_end" && event.message?.role === "assistant") {
				outputTokens += event.message.usage?.output ?? 0;
				cost += event.message.usage?.cost?.total ?? 0;
				const blocks = event.message.content ?? [];
				for (const b of blocks) {
					if (b.type === "text" && typeof b.text === "string") outputText += b.text;
				}
			}
		} catch {
			/* non-JSON line */
		}
	}

	return { promptId: prompt.id, intensity, seed, outputText, outputTokens, cost };
}

// ---------------------------------------------------------------------------
// Haiku-as-judge
// ---------------------------------------------------------------------------

const JUDGE_RUBRIC_SYSTEM = `You are an impartial evaluator. Given a prompt and a candidate response, score the candidate on three axes, each integer 0–10.

- completeness: Does the response cover what the prompt asks for, not skip or misinterpret?
- correctness: Is every technical claim correct and nothing misleading?
- helpfulness: Is it usable by the asker — actionable, right length, right level of detail?

Respond in STRICT JSON ONLY:

{"completeness": N, "correctness": N, "helpfulness": N, "rationale": "one short sentence"}

No preamble, no code fences, nothing but that JSON object.`;

function buildJudgeUserMessage(prompt: OutputPrompt, candidate: string): string {
	return `## Original prompt
${prompt.prompt}

## Candidate response
${candidate || "<empty response>"}

Evaluate the candidate per the rubric. Return JSON only.`;
}

async function callJudgeOnce(
	prompt: OutputPrompt,
	candidate: string,
	apiKey: string,
	model: string,
): Promise<QualityJudgeScore> {
	const resp = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model,
			max_tokens: 300,
			system: JUDGE_RUBRIC_SYSTEM,
			messages: [{ role: "user", content: buildJudgeUserMessage(prompt, candidate) }],
		}),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "<no body>");
		throw new Error(`judge ${resp.status}: ${text.slice(0, 200)}`);
	}
	const json = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
	const textBlock = (json.content ?? []).find((b) => b.type === "text");
	if (!textBlock?.text) throw new Error("judge returned no text");
	const parsed = parseJudgeJson(textBlock.text);
	return parsed;
}

export function parseJudgeJson(text: string): QualityJudgeScore {
	// Tolerate a stray code fence or leading prose by scanning for the first {...}.
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) throw new Error(`judge json not found: ${text.slice(0, 120)}`);
	const jsonText = text.slice(start, end + 1);
	const obj = JSON.parse(jsonText) as Partial<QualityJudgeScore> & Record<string, unknown>;
	const clamp = (x: unknown) => {
		const n = typeof x === "number" ? x : Number(x);
		if (Number.isNaN(n)) return 0;
		return Math.max(0, Math.min(10, n));
	};
	const completeness = clamp(obj.completeness);
	const correctness = clamp(obj.correctness);
	const helpfulness = clamp(obj.helpfulness);
	const overall = (completeness + correctness + helpfulness) / 3;
	return {
		completeness,
		correctness,
		helpfulness,
		overall,
		rationale: typeof obj.rationale === "string" ? obj.rationale : "",
	};
}

export async function judgeOutput(
	prompt: OutputPrompt,
	candidate: string,
	apiKey: string,
	runs: number = DEFAULT_JUDGE_RUNS,
	model: string = DEFAULT_JUDGE_MODEL,
): Promise<number> {
	const scores: number[] = [];
	for (let i = 0; i < runs; i++) {
		const s = await callJudgeOnce(prompt, candidate, apiKey, model);
		scores.push(s.overall);
	}
	// Median over runs (take min for conservative floor if only 2 runs).
	scores.sort((a, b) => a - b);
	return runs === 2 ? scores[0] : scores[Math.floor(runs / 2)];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface OutputEvalOptions {
	prompts?: OutputPrompt[];
	intensities?: Intensity[];
	seeds?: number[];
	apiKey: string;
	model?: string;
	judgeModel?: string;
	judgeRuns?: number;
	qualityGap?: number;
	caveBin?: string;
	onProgress?: (msg: string) => void;
}

export async function runOutputEval(opts: OutputEvalOptions): Promise<{ rows: OutputEvalRow[]; totalCost: number }> {
	const prompts = opts.prompts ?? loadOutputPrompts();
	const intensities = opts.intensities ?? (["off", "lite", "full", "ultra"] as Intensity[]);
	const seeds = opts.seeds ?? [0, 1];
	const qualityGap = opts.qualityGap ?? DEFAULT_QUALITY_GAP;
	const progress = opts.onProgress ?? (() => {});

	// Step 1: generate under every (prompt, intensity, seed)
	const gens = new Map<string, GenerationResult[]>(); // key = `${promptId}|${intensity}`
	let totalCost = 0;
	for (const p of prompts) {
		for (const intensity of intensities) {
			const key = `${p.id}|${intensity}`;
			gens.set(key, []);
			for (const seed of seeds) {
				progress(`gen ${p.id} @${intensity} seed=${seed}`);
				const g = generateOne(p, intensity, seed, opts.caveBin, opts.model);
				gens.get(key)!.push(g);
				totalCost += g.cost;
			}
		}
	}

	// Step 2: judge each (prompt, intensity) aggregate — take the mean across seeds
	// of the judged quality of each generation. Then compare intensity to off.
	const rows: OutputEvalRow[] = [];
	const judgeRuns = opts.judgeRuns ?? DEFAULT_JUDGE_RUNS;
	const judgeModel = opts.judgeModel ?? DEFAULT_JUDGE_MODEL;

	// Judge off quality per prompt first so we have the acceptance baseline
	const offQualityByPrompt = new Map<string, number>();

	for (const p of prompts) {
		let sum = 0;
		const runs = gens.get(`${p.id}|off`) ?? [];
		for (const g of runs) {
			progress(`judge ${p.id} off seed=${g.seed}`);
			const q = await judgeOutput(p, g.outputText, opts.apiKey, judgeRuns, judgeModel);
			sum += q;
		}
		const mean = runs.length === 0 ? 0 : sum / runs.length;
		offQualityByPrompt.set(p.id, mean);

		// Emit one row per seed for off so reporter can show full distribution, but
		// schema expects one row per (promptId, intensity); aggregate by mean.
		rows.push({
			promptId: p.id,
			intensity: "off",
			outputTokens: runs.length === 0 ? 0 : Math.round(runs.reduce((a, b) => a + b.outputTokens, 0) / runs.length),
			qualityScore: mean,
			judgeRuns,
			accepted: true,
		});
	}

	// Judge each non-off intensity
	for (const p of prompts) {
		const baseQ = offQualityByPrompt.get(p.id) ?? 0;
		for (const intensity of intensities) {
			if (intensity === "off") continue;
			const runs = gens.get(`${p.id}|${intensity}`) ?? [];
			let sum = 0;
			for (const g of runs) {
				progress(`judge ${p.id} @${intensity} seed=${g.seed}`);
				const q = await judgeOutput(p, g.outputText, opts.apiKey, judgeRuns, judgeModel);
				sum += q;
			}
			const mean = runs.length === 0 ? 0 : sum / runs.length;
			const accepted = baseQ - mean <= qualityGap;
			rows.push({
				promptId: p.id,
				intensity,
				outputTokens:
					runs.length === 0 ? 0 : Math.round(runs.reduce((a, b) => a + b.outputTokens, 0) / runs.length),
				qualityScore: mean,
				judgeRuns,
				accepted,
			});
		}
	}

	return { rows, totalCost };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		process.stderr.write("ANTHROPIC_API_KEY required\n");
		process.exit(2);
	}
	const outPath = process.argv[2] ?? join(__dirname, "output-eval.json");
	(async () => {
		const { rows, totalCost } = await runOutputEval({
			apiKey,
			onProgress: (m) => process.stderr.write(`${m}\n`),
		});
		writeFileSync(outPath, JSON.stringify({ rows, totalCost }, null, 2));
		process.stdout.write(`Wrote ${outPath}\n`);
		process.stdout.write(`Total cost: $${totalCost.toFixed(4)}\n`);
	})().catch((e) => {
		process.stderr.write(`${String(e)}\n`);
		process.exit(1);
	});
}
