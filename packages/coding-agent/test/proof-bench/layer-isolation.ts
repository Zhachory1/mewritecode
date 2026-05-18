/**
 * Layer isolation — per-layer token savings on the pinned corpus-tools-v1 fixtures.
 *
 * Pure, offline, $0. Emits structured results matching the `layerIsolation`
 * section of schema/results.schema.json.
 *
 * Run directly with: `npx tsx layer-isolation.ts`
 * Import via:       `import { runLayerIsolation } from "./layer-isolation.js"`
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compressStructuredOutput } from "../../src/core/cave-structured-compression.js";
import {
	collapseBlankLines,
	compressCaveToolOutput,
	stripAnsi,
	truncateLongOutput,
	truncateWithToolBudget,
} from "../../src/core/cave-tool-compression.js";
import { buildCaveModePrompt } from "../../src/core/system-prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "datasets", "corpus-tools-v1");

const CHARS_PER_TOKEN = 4;

export interface LayerIsolationRow {
	fixture: string;
	layer: string;
	before: number;
	after: number;
	savedPct: number;
}

interface Fixture {
	name: string;
	content: string;
	toolName: string;
	commandHint: string | undefined;
}

function tokensOf(s: string): number {
	return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function inferToolName(filename: string): string {
	if (filename.includes("grep")) return "grep";
	if (filename.includes("ls") || filename.includes("recursive")) return "ls";
	if (filename.includes("read") || filename.endsWith(".ts.txt")) return "read";
	return "bash";
}

function inferCommandHint(filename: string): string | undefined {
	if (filename.includes("docker")) return "docker inspect";
	if (filename.includes("npm")) return "npm ls";
	if (filename.includes("git")) return "git diff";
	return undefined;
}

function loadFixtures(): Fixture[] {
	const files = readdirSync(CORPUS_DIR)
		.filter((f) => f.endsWith(".txt"))
		.sort();
	return files.map((name) => ({
		name,
		content: readFileSync(join(CORPUS_DIR, name), "utf-8"),
		toolName: inferToolName(name),
		commandHint: inferCommandHint(name),
	}));
}

function row(fixture: string, layer: string, before: number, after: number): LayerIsolationRow {
	return {
		fixture,
		layer,
		before,
		after,
		savedPct: before === 0 ? 0 : ((before - after) / before) * 100,
	};
}

/**
 * Apply compression layers one at a time, each starting from the raw fixture.
 * This gives a clean "what does this single layer save?" number, not a cumulative one.
 */
function isolateLayersOnFixture(f: Fixture): LayerIsolationRow[] {
	const base = tokensOf(f.content);
	const rows: LayerIsolationRow[] = [];

	rows.push(row(f.name, "ansi-strip", base, tokensOf(stripAnsi(f.content))));
	rows.push(row(f.name, "blank-collapse", base, tokensOf(collapseBlankLines(f.content))));

	const budget = truncateWithToolBudget(f.content, f.toolName);
	rows.push(row(f.name, "flint-budget", base, tokensOf(budget)));

	rows.push(
		row(f.name, "stone-structured", base, tokensOf(compressStructuredOutput(f.content, f.toolName, f.commandHint))),
	);

	rows.push(row(f.name, "truncate-500-line", base, tokensOf(truncateLongOutput(f.content))));

	rows.push(row(f.name, "full-cave-pipeline", base, tokensOf(compressCaveToolOutput(f.content))));

	return rows;
}

/**
 * System-prompt overhead by intensity. Emitted alongside layer rows so the
 * reporter can produce a break-even curve.
 */
function systemPromptOverheadRows(): LayerIsolationRow[] {
	const off = "";
	const lite = buildCaveModePrompt("lite");
	const full = buildCaveModePrompt("full");
	const ultra = buildCaveModePrompt("ultra");
	const offTokens = tokensOf(off);
	return [
		{
			fixture: "<system-prompt>",
			layer: "caveMode-prompt-lite",
			before: offTokens,
			after: tokensOf(lite),
			savedPct: -tokensOf(lite),
		},
		{
			fixture: "<system-prompt>",
			layer: "caveMode-prompt-full",
			before: offTokens,
			after: tokensOf(full),
			savedPct: -tokensOf(full),
		},
		{
			fixture: "<system-prompt>",
			layer: "caveMode-prompt-ultra",
			before: offTokens,
			after: tokensOf(ultra),
			savedPct: -tokensOf(ultra),
		},
	];
}

export function runLayerIsolation(): LayerIsolationRow[] {
	const fixtures = loadFixtures();
	const out: LayerIsolationRow[] = [];
	for (const f of fixtures) {
		out.push(...isolateLayersOnFixture(f));
	}
	out.push(...systemPromptOverheadRows());
	return out;
}

/** Aggregate per-layer median savedPct across all fixtures. */
export function aggregateByLayer(rows: LayerIsolationRow[]): Array<{
	layer: string;
	fixtures: number;
	medianSavedPct: number;
	meanSavedPct: number;
}> {
	const byLayer = new Map<string, number[]>();
	for (const r of rows) {
		if (r.fixture === "<system-prompt>") continue;
		if (!byLayer.has(r.layer)) byLayer.set(r.layer, []);
		byLayer.get(r.layer)!.push(r.savedPct);
	}
	const out: Array<{ layer: string; fixtures: number; medianSavedPct: number; meanSavedPct: number }> = [];
	for (const [layer, values] of byLayer.entries()) {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		out.push({ layer, fixtures: values.length, medianSavedPct: median, meanSavedPct: mean });
	}
	out.sort((a, b) => b.medianSavedPct - a.medianSavedPct);
	return out;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
	const rows = runLayerIsolation();
	const agg = aggregateByLayer(rows);
	process.stdout.write(`${JSON.stringify({ rows, aggregate: agg }, null, 2)}\n`);
}
