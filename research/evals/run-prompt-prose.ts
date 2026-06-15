#!/usr/bin/env npx tsx
/**
 * run-prompt-prose.ts — single-prompt PROSE microbench for Cave CLI.
 *
 * GOAL: isolate, as cleanly as possible, how much caveman PROSE shrinks a model's
 * RESPONSE on ONE question→answer turn — no tools, no agent loop, no SWE-bench, no
 * Docker. For each (prompt × prose∈{off,full}) we spin up a FRESH single-turn
 * session (`tools: []`, `maxTurns: 1`), ask the same question, and compare OUTPUT
 * tokens. prose-off = caveman fully disabled for the session; prose-full = caveman
 * enabled at "full" intensity (mirrors run-swebench's --cave wiring). The metric is
 * %output-reduction = (out_off − out_full) / out_off.
 *
 * ── HONESTY NOTE (read before quoting any number) ───────────────────────────────
 * This measures OUTPUT-prose compression on SINGLE turns ONLY. It is a CLEAN but
 * PARTIAL view of caveman's effect: it captures how terse-prose styling shrinks the
 * model's generated answer, and nothing else. Real-usage savings ALSO come from
 *   (a) INPUT / tool-output compression (the separate compression knob, #33), and
 *   (b) prompt-cache reuse amortized over LONG multi-turn sessions (#36).
 * Neither of those is exercised here (no tools, one turn, no cache warm-up). Do NOT
 * present this %output-reduction as a total-cost saving — it is the output-prose
 * slice in isolation. See research/results/* and #36 for the full picture.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Cheap by construction: a cheap default model (gpt-4o-mini), one turn each, a
 * handful of prompts × 2 conditions = pennies. The operator runs the PAID part;
 * `--dry-run` makes NO network/SDK calls (prints the plan + prompt ids only).
 *
 * The %reduction / aggregation / prompt-loading+inlining logic is factored into
 * PURE exported helpers (no I/O, no SDK) so research/evals/__tests__ can cover them
 * without touching the network.
 *
 * Usage:
 *   npx tsx research/evals/run-prompt-prose.ts [options]
 *
 * Options:
 *   --model <pattern>   Model id (default: gpt-4o-mini — cheap)
 *   --provider <name>   LLM provider (default: openai)
 *   --limit <n>         Max prompts to run (default: all)
 *   --output <dir>      Output dir (default: research/results/prose-<date>/)
 *   --prompts <jsonl>   Override built-in prompt set; each line {id, question}
 *   --dry-run           Print the plan + prompt ids, NO network/SDK calls
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "../../packages/agent/src/index.js";
import { getModel } from "../../packages/ai/src/models.js";
import { createAgentSession } from "../../packages/coding-agent/src/core/sdk.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { SettingsManager } from "../../packages/coding-agent/src/core/settings-manager.js";
import { type Usage, meanSdMedian } from "./honest-metrics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two prose conditions this microbench contrasts. */
export type ProseCondition = "off" | "full";

/** One prompt: a stable id and the natural-language question to ask. */
export interface PromptSpec {
	id: string;
	question: string;
}

/** Per-condition capture for one prompt: usage + the assistant response text. */
export interface ConditionResult {
	usage: Usage;
	responseText: string;
}

/**
 * Per-prompt comparison record. `reductionPct` is the OUTPUT-token reduction
 * (off→full); null when off produced 0 output tokens (undefined ratio — never
 * fabricate a reduction from a zero denominator).
 */
export interface PromptProseResult {
	id: string;
	question: string;
	off: ConditionResult;
	full: ConditionResult;
	/** out_off − out_full (output tokens saved by prose). Can be negative if full was longer. */
	outputDelta: number;
	/** (out_off − out_full) / out_off, in [−∞, 1]. null when out_off === 0. */
	reductionPct: number | null;
	/** input_off − input_full (negative: the cave block ADDS input tokens). Diagnostic. */
	inputDelta: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O, no SDK) — unit-tested in __tests__
// ---------------------------------------------------------------------------

/**
 * OUTPUT-token reduction for one prompt: (out_off − out_full) / out_off.
 * PURE. Returns null when `outputOff` is 0 (undefined ratio — do not divide by
 * zero or invent a reduction). A negative result means prose-full produced MORE
 * output than prose-off (prose made it longer) — reported honestly, not clamped.
 */
export function outputReductionPct(outputOff: number, outputFull: number): number | null {
	if (outputOff === 0) return null;
	return (outputOff - outputFull) / outputOff;
}

/**
 * Build the per-prompt comparison record from the two captured conditions.
 * PURE. Computes the output delta, %reduction (null-safe), and input delta.
 */
export function buildPromptResult(spec: PromptSpec, off: ConditionResult, full: ConditionResult): PromptProseResult {
	return {
		id: spec.id,
		question: spec.question,
		off,
		full,
		outputDelta: off.usage.output - full.usage.output,
		reductionPct: outputReductionPct(off.usage.output, full.usage.output),
		inputDelta: off.usage.input - full.usage.input,
	};
}

/**
 * Aggregate the median %output-reduction across prompts (reuses meanSdMedian).
 * PURE. Only prompts with a DEFINED reduction (out_off > 0) contribute — a null
 * reduction (zero-output baseline) is excluded rather than counted as 0, so the
 * median isn't dragged toward zero by undefined cases. Returns the meanSdMedian
 * stats over the contributing fractions plus `nExcluded` for transparency.
 */
export function aggregateReduction(results: PromptProseResult[]): {
	median: number;
	mean: number;
	sd: number;
	n: number;
	nExcluded: number;
} {
	const fractions: number[] = [];
	let nExcluded = 0;
	for (const r of results) {
		if (r.reductionPct === null) nExcluded += 1;
		else fractions.push(r.reductionPct);
	}
	const stats = meanSdMedian(fractions);
	return { ...stats, nExcluded };
}

/**
 * Parse a `--prompts` JSONL override into PromptSpec[]. PURE (takes file CONTENTS,
 * not a path). Blank lines are skipped. Each non-blank line must be a JSON object
 * with non-empty string `id` and `question`; anything else throws with the 1-based
 * line number so a malformed override fails loudly rather than silently dropping
 * prompts.
 */
export function parsePromptsJsonl(contents: string): PromptSpec[] {
	const out: PromptSpec[] = [];
	const lines = contents.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`--prompts line ${i + 1}: not valid JSON`);
		}
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error(`--prompts line ${i + 1}: expected a JSON object {id, question}`);
		}
		const obj = parsed as Record<string, unknown>;
		if (typeof obj.id !== "string" || obj.id.trim() === "") {
			throw new Error(`--prompts line ${i + 1}: missing/empty string "id"`);
		}
		if (typeof obj.question !== "string" || obj.question.trim() === "") {
			throw new Error(`--prompts line ${i + 1}: missing/empty string "question"`);
		}
		out.push({ id: obj.id, question: obj.question });
	}
	return out;
}

/**
 * Truncate `text` to at most `maxChars`, appending a clear marker when cut, so an
 * inlined source file stays English-readable-sized and the prompt cost stays low.
 * PURE. Cuts on a whole line where possible (avoids slicing mid-line) and never
 * returns more than `maxChars` of original content.
 */
export function truncateForInline(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = text.slice(0, maxChars);
	const lastNl = head.lastIndexOf("\n");
	const body = lastNl > 0 ? head.slice(0, lastNl) : head;
	return `${body}\n... [truncated for benchmark — ${text.length - body.length} more chars]`;
}

/**
 * Compose a grounded "explain this source" question that INLINES a file's contents
 * (already truncated by the caller). PURE — the file is read by the caller; this
 * just formats the prompt so the model produces grounded PROSE we can measure.
 */
export function buildInlinedQuestion(label: string, language: string, contents: string): string {
	return [
		`Below is ${label} from a TypeScript codebase. Explain what it does and summarize its design.`,
		"",
		`\`\`\`${language}`,
		contents,
		"```",
	].join("\n");
}

/**
 * Render the per-prompt markdown table: prompt | out_off | out_full | Δ% .
 * PURE. Δ% is shown to one decimal place; a null reduction (zero-output baseline)
 * renders as "n/a" rather than a fabricated number.
 */
export function renderMarkdownTable(results: PromptProseResult[]): string {
	const rows = [
		"| prompt | out_off | out_full | Δ out | Δ% |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const r of results) {
		const pct = r.reductionPct === null ? "n/a" : `${(r.reductionPct * 100).toFixed(1)}%`;
		rows.push(`| ${r.id} | ${r.off.usage.output} | ${r.full.usage.output} | ${r.outputDelta} | ${pct} |`);
	}
	return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Built-in prompt set — grounded "explain this source file" questions.
// Files are read from THIS repo at runtime (repoRoot) and truncated so each
// prompt stays modest. Override with --prompts <jsonl>.
// ---------------------------------------------------------------------------

interface InlineSource {
	id: string;
	label: string;
	language: string;
	/** Path relative to repo root. */
	relPath: string;
	/** Max chars of file contents to inline. */
	maxChars: number;
}

const BUILTIN_SOURCES: InlineSource[] = [
	{
		id: "agent-roles",
		label: "the role-tagging module `packages/agent/src/roles.ts`",
		language: "ts",
		relPath: "packages/agent/src/roles.ts",
		maxChars: 2000,
	},
	{
		id: "honest-metrics-header",
		label: "the header + token/pricing section of `research/evals/honest-metrics.ts`",
		language: "ts",
		relPath: "research/evals/honest-metrics.ts",
		maxChars: 2600,
	},
	{
		id: "ai-types-messages",
		label: "the message-type definitions from `packages/ai/src/types.ts`",
		language: "ts",
		relPath: "packages/ai/src/types.ts",
		maxChars: 2400,
	},
	{
		id: "settings-cave-knobs",
		label: "the caveman-mode setters from `packages/coding-agent/src/core/settings-manager.ts`",
		language: "ts",
		relPath: "packages/coding-agent/src/core/settings-manager.ts",
		maxChars: 2200,
	},
	{
		id: "readme-trick",
		label: "a section of the project `README.md`",
		language: "md",
		relPath: "README.md",
		maxChars: 2000,
	},
];

/**
 * Load + inline the built-in prompt set from the repo. NOT pure (reads files) —
 * kept thin: it reads each source, calls the PURE truncateForInline +
 * buildInlinedQuestion, and returns the specs. Failures to read a file are fatal
 * (a microbench on missing source would be silently meaningless).
 */
function loadBuiltinPrompts(repoRoot: string): PromptSpec[] {
	const out: PromptSpec[] = [];
	for (const src of BUILTIN_SOURCES) {
		const raw = readFileSync(join(repoRoot, src.relPath), "utf8");
		const inlined = truncateForInline(raw, src.maxChars);
		out.push({ id: src.id, question: buildInlinedQuestion(src.label, src.language, inlined) });
	}
	return out;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface RunConfig {
	model: string;
	provider: string;
	limit?: number;
	outputDir?: string;
	promptsPath?: string;
	dryRun: boolean;
}

function parseRunArgs(argv: string[]): RunConfig {
	const args = argv.slice(2);
	const config: RunConfig = {
		model: "gpt-4o-mini",
		provider: "openai",
		dryRun: false,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--model":
				config.model = args[++i];
				break;
			case "--provider":
				config.provider = args[++i];
				break;
			case "--limit":
				config.limit = Number(args[++i]);
				break;
			case "--output":
				config.outputDir = resolve(args[++i]);
				break;
			case "--prompts":
				config.promptsPath = resolve(args[++i]);
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
// Logging + response extraction
// ---------------------------------------------------------------------------

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}] ${msg}`);
}

/**
 * Concatenate the text content of the LAST assistant message in a message list.
 * PURE over the message array (no SDK call) — exported so a fixture of messages
 * can be tested without a live session.
 */
export function lastAssistantText(messages: { role: string; content: unknown }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		if (!Array.isArray(m.content)) return "";
		return m.content
			.filter(
				(c): c is { type: string; text: string } =>
					typeof c === "object" &&
					c !== null &&
					(c as { type?: unknown }).type === "text" &&
					typeof (c as { text?: unknown }).text === "string",
			)
			.map((c) => c.text)
			.join("");
	}
	return "";
}

// ---------------------------------------------------------------------------
// Single-condition run (PAID path — never reached in --dry-run)
// ---------------------------------------------------------------------------

async function runCondition(
	spec: PromptSpec,
	condition: ProseCondition,
	config: RunConfig,
	cwd: string,
): Promise<ConditionResult> {
	const model = getModel(config.provider as any, config.model as any);
	if (!model) {
		throw new Error(`Model not found: ${config.provider}/${config.model}`);
	}

	// Fresh settings per condition. For prose-off, disable cave entirely (mirrors
	// run-swebench's --cave off). For prose-full, enable cave + full intensity.
	const settingsManager = SettingsManager.create(cwd);
	if (condition === "off") {
		settingsManager.setCaveModeEnabled(false);
	} else {
		settingsManager.setCaveModeEnabled(true);
		settingsManager.setCaveModeIntensity("full");
	}

	// FRESH single-turn Q&A session: NO tools, maxTurns 1.
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off" as ThinkingLevel,
		tools: [],
		maxTurns: 1,
		settingsManager,
		sessionManager: SessionManager.inMemory(cwd),
	});

	// Let the async runtime build settle (mirrors run-swebench).
	await new Promise((r) => setTimeout(r, 100));

	// Session-level prose wiring (the system-prompt block honors the session flag).
	if (condition === "off") {
		session.setCaveModeSessionDisabled();
	} else {
		session.setCaveModeSessionIntensity("full");
	}

	await session.prompt(spec.question, { expandPromptTemplates: false });

	const stats = session.getSessionStats();
	const responseText = lastAssistantText(session.messages as { role: string; content: unknown }[]);

	return {
		usage: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
		},
		responseText,
	};
}

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------

function writeOutputs(outputDir: string, results: PromptProseResult[], config: RunConfig): void {
	mkdirSync(outputDir, { recursive: true });
	const agg = aggregateReduction(results);

	// results.json — per-prompt usage both conditions + %reduction + aggregate.
	const resultsJson = {
		generatedAt: new Date().toISOString(),
		config: { model: config.model, provider: config.provider },
		honestyNote:
			"OUTPUT-prose compression on SINGLE turns only — a clean but PARTIAL view. " +
			"Real savings also come from input/tool-output compression + prompt-cache reuse over long sessions (#36). " +
			"Do NOT present this as total cost savings.",
		aggregate: {
			medianOutputReductionPct: agg.median,
			meanOutputReductionPct: agg.mean,
			sd: agg.sd,
			nPrompts: agg.n,
			nExcludedZeroBaseline: agg.nExcluded,
		},
		prompts: results.map((r) => ({
			id: r.id,
			off: r.off.usage,
			full: r.full.usage,
			outputDelta: r.outputDelta,
			reductionPct: r.reductionPct,
			inputDelta: r.inputDelta,
		})),
	};
	writeFileSync(join(outputDir, "results.json"), JSON.stringify(resultsJson, null, 2));

	// table.md — per-prompt table + aggregate line.
	const md = [
		"# Prose Microbench — output-token reduction (single-turn Q&A)",
		"",
		"> HONESTY: OUTPUT-prose compression on SINGLE turns only — a clean but PARTIAL view.",
		"> Real savings also come from input/tool-output compression + prompt-cache reuse over long sessions (#36).",
		"> Do NOT present this as total cost savings.",
		"",
		`Model: \`${config.provider}/${config.model}\``,
		"",
		renderMarkdownTable(results),
		"",
		`**Median output reduction:** ${(agg.median * 100).toFixed(1)}% ` +
			`(mean ${(agg.mean * 100).toFixed(1)}%, n=${agg.n}, excluded zero-baseline=${agg.nExcluded})`,
		"",
	].join("\n");
	writeFileSync(join(outputDir, "table.md"), md);

	// responses.md — the TEXT for both conditions per prompt (quality eyeballable).
	const respLines: string[] = ["# Prose Microbench — responses (off vs full)", ""];
	for (const r of results) {
		respLines.push(`## ${r.id}`, "");
		respLines.push(`### prose=off (${r.off.usage.output} output tokens)`, "", r.off.responseText, "");
		respLines.push(`### prose=full (${r.full.usage.output} output tokens)`, "", r.full.responseText, "");
	}
	writeFileSync(join(outputDir, "responses.md"), respLines.join("\n"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function repoRootFromHere(): string {
	// this file lives at <root>/research/evals/run-prompt-prose.ts
	return resolve(fileURLToPath(import.meta.url), "../../..");
}

async function main(): Promise<void> {
	const config = parseRunArgs(process.argv);
	const repoRoot = repoRootFromHere();

	// Load prompts: override or built-in.
	let prompts: PromptSpec[];
	if (config.promptsPath) {
		prompts = parsePromptsJsonl(readFileSync(config.promptsPath, "utf8"));
	} else {
		prompts = loadBuiltinPrompts(repoRoot);
	}
	if (config.limit && config.limit > 0) prompts = prompts.slice(0, config.limit);

	const date = new Date().toISOString().slice(0, 10);
	const outputDir = config.outputDir ?? resolve(repoRoot, "research/results", `prose-${date}`);

	log("=== Prose Microbench (single-turn Q&A, no tools) ===");
	log(`Provider: ${config.provider} | Model: ${config.model}`);
	log(`Prompts: ${prompts.length} | Conditions: off, full | Output: ${outputDir}`);
	log("HONESTY: OUTPUT-prose compression on SINGLE turns only — PARTIAL view, NOT total cost (#36).");

	if (config.dryRun) {
		log("DRY RUN — NO network/SDK calls. Plan:");
		for (const p of prompts) {
			console.log(`  ${p.id}  (question ${p.question.length} chars)`);
		}
		log(`Would run ${prompts.length} prompts × 2 conditions = ${prompts.length * 2} single-turn calls.`);
		return;
	}

	const results: PromptProseResult[] = [];
	for (const spec of prompts) {
		log(`[${spec.id}] prose=off ...`);
		const off = await runCondition(spec, "off", config, repoRoot);
		log(`[${spec.id}] prose=full ...`);
		const full = await runCondition(spec, "full", config, repoRoot);
		const r = buildPromptResult(spec, off, full);
		const pct = r.reductionPct === null ? "n/a" : `${(r.reductionPct * 100).toFixed(1)}%`;
		log(`[${spec.id}] out_off=${off.usage.output} out_full=${full.usage.output} Δ%=${pct}`);
		results.push(r);
	}

	writeOutputs(outputDir, results, config);
	const agg = aggregateReduction(results);
	log("=== Results ===");
	log(`Median output reduction: ${(agg.median * 100).toFixed(1)}% (n=${agg.n}, excluded=${agg.nExcluded})`);
	log(`Output dir: ${outputDir}`);
}

// Only run main when executed directly (not when imported by tests, which pull in
// the pure helpers without making any network/SDK calls).
const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
