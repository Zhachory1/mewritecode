#!/usr/bin/env npx tsx
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CompressionPipeline, sumTextLen } from "../../packages/coding-agent/src/core/compression-pipeline.js";
import { SavingsTracker } from "../../packages/coding-agent/src/core/savings-tracker.js";

const SCHEMA_VERSION = 1;
const FIXTURE_VERSION = "m0-2026-06-30-v1";
const HEADROOM_TIMEOUT_MS = 120_000;
const NAIVE_KEEP_RATIO = 0.2;

type EntityType = "log" | "json" | "diff" | "source" | "rag-json";
type BackendName =
	| "none"
	| "naive-head"
	| "naive-head-tail"
	| "caveman"
	| "headroom"
	| "headroom-aggressive"
	| "headroom-tool-result"
	| "hybrid";
type ScorerName = "set-regex" | "source-helper";
type SafeCandidate = "safe" | "unsafe" | "unevaluated";

interface Fixture {
	id: string;
	entity: EntityType;
	filename: string;
	content: string;
	toolName: string;
	args: Record<string, unknown>;
}

interface CaseDefinition {
	id: string;
	fixtureId: string;
	description: string;
	scorer: ScorerName;
	expected: string[];
	pattern?: string;
	allowExtraFacts?: boolean;
}

interface CompressedEntity {
	backend: BackendName;
	content: string;
	bytesBefore: number;
	bytesAfter: number;
	transforms: string[];
	skipped?: string;
}

interface ScoreResult {
	caseId: string;
	backend: BackendName;
	bytesBefore: number;
	bytesAfter: number;
	savingsPct: number;
	score: number;
	precision: number;
	recall: number;
	actual: string[];
	expected: string[];
	transforms: string[];
	skipped?: string;
	safeCandidate: SafeCandidate;
	unsafeReasons: string[];
}

interface CompressionQualityReport {
	schemaVersion: typeof SCHEMA_VERSION;
	fixtureVersion: string;
	repoCommit?: string;
	generatedAt: string;
	backendVersions: Record<string, string>;
	backendConfigs: Record<string, unknown>;
	results: ScoreResult[];
}

interface RunOptions {
	outDir: string;
	jsonOnly: boolean;
}

function parseArgs(): RunOptions {
	const args = process.argv.slice(2);
	const options: RunOptions = {
		outDir: resolve("research/results/compression-quality"),
		jsonOnly: false,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--out":
				options.outDir = resolve(args[++i] ?? options.outDir);
				break;
			case "--json":
				options.jsonOnly = true;
				break;
			default:
				throw new Error(`Unknown arg: ${arg}`);
		}
	}
	return options;
}

function repoCommit(): string | undefined {
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function makeLogFixture(): string {
	const lines: string[] = [];
	for (let i = 1; i <= 800; i++) {
		if ([39, 177, 333, 604].includes(i)) {
			lines.push(
				`2026-06-30T12:${String(i % 60).padStart(2, "0")}:00Z ERROR payment worker failed request_id=req-${i} stack=DatabaseTimeout retry=3 user=redacted shard=${i % 12}`,
			);
		} else {
			lines.push(
				`2026-06-30T12:${String(i % 60).padStart(2, "0")}:00Z INFO payment worker heartbeat shard=${i % 12} latency_ms=${20 + (i % 7)} queue_depth=${i % 5}`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

function makeJsonFixture(): string {
	const rows: unknown[] = [];
	for (let i = 1; i <= 500; i++) {
		rows.push({
			id: i,
			type: "event",
			status: i % 73 === 0 ? "error" : "ok",
			service: "checkout",
			region: "us-east-1",
			latency_ms: 20 + (i % 11),
			metadata: {
				tenant: "acme",
				trace: `trace-${String(i).padStart(4, "0")}`,
				request_id: `req-${i}`,
			},
		});
	}
	return JSON.stringify(rows, null, 2);
}

function makeDiffFixture(): string {
	const lines: string[] = [];
	for (let i = 1; i <= 250; i++) {
		lines.push(`diff --git a/src/file${i}.ts b/src/file${i}.ts`);
		lines.push("index 0000000..1111111 100644");
		lines.push(`--- a/src/file${i}.ts`);
		lines.push(`+++ b/src/file${i}.ts`);
		lines.push("@@ -1,5 +1,5 @@");
		lines.push(`-export const value${i} = oldThing(${i});`);
		lines.push(`+export const value${i} = newThing(${i});`);
	}
	return `${lines.join("\n")}\n`;
}

function makeSourceFixture(): string {
	const lines: string[] = [];
	for (let i = 1; i <= 300; i++) {
		lines.push(`export function helper${i}(input: string): string {`);
		lines.push("  const normalized = input.trim().toLowerCase();");
		lines.push(`  return \`${"${normalized}"}-${i}\`;`);
		lines.push("}");
		lines.push("");
	}
	return lines.join("\n");
}

function makeRagJsonFixture(): string {
	const chunks: unknown[] = [];
	for (let i = 1; i <= 80; i++) {
		chunks.push({
			id: `chunk-${i}`,
			file: i === 37 ? "src/helpers.ts" : `src/module-${i}.ts`,
			symbol: i === 37 ? "helper217" : `helper${i}`,
			score: i === 37 ? 0.97 : Number((0.55 + (i % 10) / 100).toFixed(2)),
			snippet:
				i === 37
					? "export function helper217(input: string): string { const normalized = input.trim().toLowerCase(); return `${normalized}-217`; }"
					: `export function helper${i}(input: string): string { return input + "-${i}"; }`,
			neighbors: [
				`import { common } from './common';`,
				`// surrounding context for helper${i}`,
				`export const helper${i}Name = "helper${i}";`,
			],
		});
	}
	return JSON.stringify(chunks, null, 2);
}

function buildFixtures(): Fixture[] {
	return [
		{
			id: "payment-log",
			entity: "log",
			filename: "log.txt",
			content: makeLogFixture(),
			toolName: "bash",
			args: { command: "cat log.txt" },
		},
		{
			id: "events-json",
			entity: "json",
			filename: "events.json",
			content: makeJsonFixture(),
			toolName: "bash",
			args: { command: "cat events.json" },
		},
		{
			id: "large-diff",
			entity: "diff",
			filename: "diff.patch",
			content: makeDiffFixture(),
			toolName: "bash",
			args: { command: "git diff" },
		},
		{
			id: "source-file",
			entity: "source",
			filename: "source.ts",
			content: makeSourceFixture(),
			toolName: "read",
			args: { path: "/tmp/source.ts" },
		},
		{
			id: "rag-json",
			entity: "rag-json",
			filename: "rag.json",
			content: makeRagJsonFixture(),
			toolName: "mcp_tool_call",
			args: { name: "repo_index_search" },
		},
	];
}

function buildCases(): CaseDefinition[] {
	return [
		{
			id: "log-error-request-ids",
			fixtureId: "payment-log",
			description: "Preserve sparse ERROR request IDs in repetitive logs.",
			scorer: "set-regex",
			expected: ["req-39", "req-177", "req-333", "req-604"],
			pattern: "req-\\d+",
		},
		{
			id: "json-error-event-ids",
			fixtureId: "events-json",
			description: "Preserve IDs for rows with status=error.",
			scorer: "set-regex",
			expected: ["73", "146", "219", "292", "365", "438"],
			pattern: "(?:\\bid[\\\":, ]+|\\b)(73|146|219|292|365|438)\\b",
		},
		{
			id: "diff-changed-files",
			fixtureId: "large-diff",
			description: "Preserve changed file paths across a large diff.",
			scorer: "set-regex",
			expected: Array.from({ length: 250 }, (_, i) => `src/file${i + 1}.ts`),
			pattern: "src/file\\d+\\.ts",
		},
		{
			id: "source-midfile-detail",
			fixtureId: "source-file",
			description: "Preserve a mid-file function and its return suffix.",
			scorer: "source-helper",
			expected: ["helper217", "-217"],
		},
		{
			id: "rag-json-target-symbol",
			fixtureId: "rag-json",
			description: "Preserve target symbol and value in RAG-shaped JSON.",
			scorer: "source-helper",
			expected: ["helper217", "-217"],
		},
	];
}

function unique(values: Iterable<string>): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function scoreSet(actual: string[], expected: string[]): Pick<ScoreResult, "score" | "precision" | "recall"> {
	const actualSet = new Set(actual);
	const expectedSet = new Set(expected);
	let hits = 0;
	for (const item of expectedSet) {
		if (actualSet.has(item)) hits++;
	}
	const precision = actualSet.size === 0 ? 0 : hits / actualSet.size;
	const recall = expectedSet.size === 0 ? 1 : hits / expectedSet.size;
	const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	return { score, precision, recall };
}

function scoreContent(
	content: string,
	testCase: CaseDefinition,
): Omit<ScoreResult, "backend" | "bytesBefore" | "bytesAfter" | "savingsPct" | "transforms" | "skipped" | "safeCandidate" | "unsafeReasons"> {
	if (testCase.scorer === "source-helper") {
		const actual = [content.includes("helper217") ? "helper217" : "", content.includes("-217") ? "-217" : ""].filter(
			Boolean,
		);
		const scores = scoreSet(actual, testCase.expected);
		return { caseId: testCase.id, actual, expected: testCase.expected, ...scores };
	}
	const regex = new RegExp(testCase.pattern ?? ".+", "g");
	const matches: string[] = [];
	for (const match of content.matchAll(regex)) {
		matches.push(match[1] ?? match[0]);
	}
	const actual = unique(matches);
	const scores = scoreSet(actual, testCase.expected);
	return { caseId: testCase.id, actual, expected: testCase.expected, ...scores };
}

function truncateUtf8(content: string, bytes: number): string {
	return Buffer.from(content, "utf8").subarray(0, Math.max(0, bytes)).toString("utf8");
}

function compressNone(fixture: Fixture): CompressedEntity {
	const bytes = Buffer.byteLength(fixture.content, "utf8");
	return { backend: "none", content: fixture.content, bytesBefore: bytes, bytesAfter: bytes, transforms: ["none"] };
}

function compressNaiveHead(fixture: Fixture): CompressedEntity {
	const before = Buffer.byteLength(fixture.content, "utf8");
	const budget = Math.max(1, Math.floor(before * NAIVE_KEEP_RATIO));
	const content = truncateUtf8(fixture.content, budget);
	return {
		backend: "naive-head",
		content,
		bytesBefore: before,
		bytesAfter: Buffer.byteLength(content, "utf8"),
		transforms: [`naive-head:${NAIVE_KEEP_RATIO}`],
	};
}

function compressNaiveHeadTail(fixture: Fixture): CompressedEntity {
	const before = Buffer.byteLength(fixture.content, "utf8");
	const halfBudget = Math.max(1, Math.floor((before * NAIVE_KEEP_RATIO) / 2));
	const buffer = Buffer.from(fixture.content, "utf8");
	const head = buffer.subarray(0, halfBudget).toString("utf8");
	const tail = buffer.subarray(Math.max(0, buffer.length - halfBudget)).toString("utf8");
	const content = `${head}\n\n[...middle omitted by naive-head-tail...]\n\n${tail}`;
	return {
		backend: "naive-head-tail",
		content,
		bytesBefore: before,
		bytesAfter: Buffer.byteLength(content, "utf8"),
		transforms: [`naive-head-tail:${NAIVE_KEEP_RATIO}`],
	};
}

async function compressCaveman(fixture: Fixture): Promise<CompressedEntity> {
	const pipeline = new CompressionPipeline(
		{
			getCaveModeMLCompression: () => false,
			getCaveModeEnabled: () => true,
		},
		new SavingsTracker(),
	);
	const before = Buffer.byteLength(fixture.content, "utf8");
	const content = await pipeline.compressToolResult(fixture.toolName, fixture.args, [
		{ type: "text", text: fixture.content },
	]);
	const after = sumTextLen(content);
	return {
		backend: "caveman",
		content: content.map((block) => block.text ?? "").join("\n"),
		bytesBefore: before,
		bytesAfter: after,
		transforms: ["caveman-rule-based"],
	};
}

function headroomPython(): string | undefined {
	return process.env.HEADROOM_PYTHON && process.env.HEADROOM_PYTHON.trim().length > 0
		? process.env.HEADROOM_PYTHON
		: undefined;
}

function getHeadroomVersion(python: string | undefined): string {
	if (!python) return "not configured";
	const result = spawnSync(
		python,
		["-c", "import headroom; print(getattr(headroom, '__version__', 'unknown'))"],
		{ encoding: "utf8", timeout: 10_000 },
	);
	return result.status === 0 ? result.stdout.trim() || "unknown" : "unavailable";
}

function compressHeadroom(
	fixture: Fixture,
	backend: "headroom" | "headroom-aggressive" | "headroom-tool-result",
): CompressedEntity {
	const before = Buffer.byteLength(fixture.content, "utf8");
	const python = headroomPython();
	if (!python) {
		return {
			backend,
			content: fixture.content,
			bytesBefore: before,
			bytesAfter: before,
			transforms: [],
			skipped: "HEADROOM_PYTHON is not set; Headroom backends are unevaluated",
		};
	}
	const importCheck = spawnSync(python, ["-c", "import headroom"], { encoding: "utf8", timeout: 10_000 });
	if (importCheck.status !== 0) {
		return {
			backend,
			content: fixture.content,
			bytesBefore: before,
			bytesAfter: before,
			transforms: [],
			skipped: `Headroom unavailable at ${python}: ${importCheck.stderr || importCheck.stdout}`.slice(0, 500),
		};
	}
	const dir = mkdtempSync(join(tmpdir(), "compression-quality-"));
	try {
		const inputPath = join(dir, "input.json");
		const outputPath = join(dir, "output.json");
		writeFileSync(
			inputPath,
			JSON.stringify({
				content: fixture.content,
				aggressive: backend === "headroom-aggressive",
				toolResultShape: backend === "headroom-tool-result",
			}),
		);
		const script = `
import json
from pathlib import Path
from headroom import compress
payload = json.loads(Path(${JSON.stringify(inputPath)}).read_text())
kwargs = {}
if payload.get("aggressive"):
    kwargs = {
        "compress_user_messages": True,
        "protect_recent": 0,
        "protect_analysis_context": False,
        "target_ratio": 0.2,
    }
if payload.get("toolResultShape"):
    messages = [{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content": payload["content"]}]}]
else:
    messages = [{"role":"user","content":"Find critical details in this content."},{"role":"tool","content": payload["content"]}]
result = compress(messages, model="gpt-4o-mini", optimize=True, **kwargs)
out = result.messages[-1].get("content", "")
if isinstance(out, list):
    text_parts = []
    for block in out:
        if isinstance(block, dict):
            value = block.get("content") if block.get("type") == "tool_result" else block.get("text")
            if isinstance(value, str):
                text_parts.append(value)
            elif isinstance(value, list):
                text_parts.extend(str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in value)
        else:
            text_parts.append(str(block))
    out = "\\n".join(text_parts)
Path(${JSON.stringify(outputPath)}).write_text(json.dumps({
    "content": out,
    "transforms": getattr(result, "transforms_applied", []),
}))
`;
		const result = spawnSync(python, ["-c", script], { encoding: "utf8", timeout: HEADROOM_TIMEOUT_MS });
		if (result.status !== 0) {
			return {
				backend,
				content: fixture.content,
				bytesBefore: before,
				bytesAfter: before,
				transforms: [],
				skipped: `Headroom failed: ${result.stderr || result.stdout}`.slice(0, 500),
			};
		}
		const output = JSON.parse(readFileSync(outputPath, "utf8")) as { content: string; transforms: string[] };
		const after = Buffer.byteLength(output.content, "utf8");
		return { backend, content: output.content, bytesBefore: before, bytesAfter: after, transforms: output.transforms };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function compressHybrid(fixture: Fixture): Promise<CompressedEntity> {
	if (fixture.entity === "json" || fixture.entity === "diff" || fixture.entity === "rag-json") {
		const headroom = compressHeadroom(fixture, "headroom-tool-result");
		return { ...headroom, backend: "hybrid" };
	}
	const caveman = await compressCaveman(fixture);
	return { ...caveman, backend: "hybrid" };
}

async function compressFixture(fixture: Fixture, backend: BackendName): Promise<CompressedEntity> {
	switch (backend) {
		case "none":
			return compressNone(fixture);
		case "naive-head":
			return compressNaiveHead(fixture);
		case "naive-head-tail":
			return compressNaiveHeadTail(fixture);
		case "caveman":
			return compressCaveman(fixture);
		case "headroom":
			return compressHeadroom(fixture, "headroom");
		case "headroom-aggressive":
			return compressHeadroom(fixture, "headroom-aggressive");
		case "headroom-tool-result":
			return compressHeadroom(fixture, "headroom-tool-result");
		case "hybrid":
			return compressHybrid(fixture);
	}
}

function classifySafety(result: ScoreResult, naiveSavingsToBeat: number): Pick<ScoreResult, "safeCandidate" | "unsafeReasons"> {
	if (result.skipped) {
		return { safeCandidate: "unevaluated", unsafeReasons: ["backend skipped"] };
	}
	const unsafeReasons: string[] = [];
	if (result.recall < 1) unsafeReasons.push(`recall ${result.recall.toFixed(3)} < 1.000`);
	if (result.precision < 1) unsafeReasons.push(`precision ${result.precision.toFixed(3)} < 1.000`);
	if (result.savingsPct <= 0) unsafeReasons.push("no positive savings");
	if (result.savingsPct <= naiveSavingsToBeat && result.backend !== "none") {
		unsafeReasons.push(`savings ${result.savingsPct.toFixed(3)} <= naive baseline ${naiveSavingsToBeat.toFixed(3)}`);
	}
	return { safeCandidate: unsafeReasons.length === 0 ? "safe" : "unsafe", unsafeReasons };
}

function applySafetyRubric(results: ScoreResult[]): void {
	const naiveByCase = new Map<string, number>();
	for (const result of results) {
		if (result.backend !== "naive-head" && result.backend !== "naive-head-tail") continue;
		if (result.recall === 1 && result.precision === 1) {
			naiveByCase.set(result.caseId, Math.max(naiveByCase.get(result.caseId) ?? 0, result.savingsPct));
		}
	}
	for (const result of results) {
		if (result.backend === "none") {
			result.safeCandidate = "unsafe";
			result.unsafeReasons = ["baseline has no savings"];
			continue;
		}
		const safety = classifySafety(result, naiveByCase.get(result.caseId) ?? 0);
		result.safeCandidate = safety.safeCandidate;
		result.unsafeReasons = safety.unsafeReasons;
	}
}

function asPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(report: CompressionQualityReport): string {
	const lines: string[] = [
		"# Compression Quality Results",
		"",
		`- Schema: ${report.schemaVersion}`,
		`- Fixture version: ${report.fixtureVersion}`,
		`- Repo commit: ${report.repoCommit ?? "unknown"}`,
		`- Headroom: ${report.backendVersions.headroom}`,
		"",
		"| Case | Backend | Candidate | Quality | Precision | Recall | Bytes | Savings | Transforms |",
		"|---|---|---|---:|---:|---:|---:|---:|---|",
	];
	for (const result of report.results) {
		const reasons = result.unsafeReasons.length > 0 ? ` (${result.unsafeReasons.join("; ")})` : "";
		lines.push(
			`| ${result.caseId} | ${result.backend}${result.skipped ? " (skipped)" : ""} | ${result.safeCandidate}${reasons} | ${asPercent(result.score)} | ${asPercent(result.precision)} | ${asPercent(result.recall)} | ${result.bytesBefore} → ${result.bytesAfter} | ${asPercent(result.savingsPct)} | ${result.transforms.join(", ")} |`,
		);
	}
	lines.push("");
	lines.push("## Skips / errors");
	const skipped = report.results.filter((r) => r.skipped);
	if (skipped.length === 0) {
		lines.push("None.");
	} else {
		for (const result of skipped) {
			lines.push(`- ${result.backend}/${result.caseId}: ${result.skipped}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
	const options = parseArgs();
	const fixtures = buildFixtures();
	const cases = buildCases();
	const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
	const backends: BackendName[] = [
		"none",
		"naive-head",
		"naive-head-tail",
		"caveman",
		"headroom",
		"headroom-aggressive",
		"headroom-tool-result",
		"hybrid",
	];
	const results: ScoreResult[] = [];

	for (const testCase of cases) {
		const fixture = fixtureById.get(testCase.fixtureId);
		if (!fixture) throw new Error(`Missing fixture: ${testCase.fixtureId}`);
		for (const backend of backends) {
			const compressed = await compressFixture(fixture, backend);
			const scored = scoreContent(compressed.content, testCase);
			results.push({
				...scored,
				backend,
				bytesBefore: compressed.bytesBefore,
				bytesAfter: compressed.bytesAfter,
				savingsPct: compressed.bytesBefore === 0 ? 0 : 1 - compressed.bytesAfter / compressed.bytesBefore,
				transforms: compressed.transforms,
				skipped: compressed.skipped,
				safeCandidate: "unsafe",
				unsafeReasons: [],
			});
		}
	}
	applySafetyRubric(results);

	const python = headroomPython();
	const report: CompressionQualityReport = {
		schemaVersion: SCHEMA_VERSION,
		fixtureVersion: FIXTURE_VERSION,
		repoCommit: repoCommit(),
		generatedAt: new Date().toISOString(),
		backendVersions: {
			mewrite: "local",
			caveman: "local",
			headroom: getHeadroomVersion(python),
		},
		backendConfigs: {
			"naive-head": { keepRatio: NAIVE_KEEP_RATIO },
			"naive-head-tail": { keepRatio: NAIVE_KEEP_RATIO },
			caveman: { mlCompression: false, ruleBased: true },
			headroom: { python: python ?? null, timeoutMs: HEADROOM_TIMEOUT_MS },
			"headroom-aggressive": {
				compressUserMessages: true,
				protectRecent: 0,
				protectAnalysisContext: false,
				targetRatio: 0.2,
			},
			"headroom-tool-result": { messageShape: "anthropic-tool-result" },
			hybrid: { json: "headroom-tool-result", diff: "headroom-tool-result", ragJson: "headroom-tool-result", fallback: "caveman" },
		},
		results,
	};

	const json = JSON.stringify(report, null, 2);
	if (options.jsonOnly) {
		console.log(json);
		return;
	}
	mkdirSync(options.outDir, { recursive: true });
	const jsonPath = join(options.outDir, "latest.json");
	const mdPath = join(options.outDir, "latest.md");
	writeFileSync(jsonPath, `${json}\n`);
	writeFileSync(mdPath, markdownReport(report));
	console.log(markdownReport(report));
	console.log(`Wrote ${jsonPath}`);
	console.log(`Wrote ${mdPath}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : String(error));
	process.exit(1);
});
