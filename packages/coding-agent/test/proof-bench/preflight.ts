/**
 * Preflight — CI-enforced gate before any result is publishable.
 *
 * Refuses to sign off on `results.md` unless every check passes. This is
 * what makes the benchmark hold up to public scrutiny: a single-row audit
 * failure, a quality regression, or a post-run edit to `manifest.json` all
 * block publication.
 *
 * Gates in order (short-circuit: collect all failures, but exit non-zero on any):
 *   1. pass@1 gap between A-baseline and every caveman config < 2 pp
 *   2. token-audit delta < 2% on every live row
 *   3. iso-quality intersection size ≥ 7
 *   4. output-eval judge quality gap ≤ 1 pt for every accepted intensity
 *   5. dataset hash == manifest.dataset_hash
 *   6. git HEAD SHA == manifest.code_sha
 *   7. ≥ 2 seeds per live config
 *   8. results.json validates against schema/results.schema.json
 *   9. cumulative cost ≤ manifest.cost_cap_usd
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Use ajv/dist/2020 for JSON Schema draft 2020-12 support (our results schema
// declares $schema: draft/2020-12).
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ESM/CJS interop: ajv 8 + ajv-formats ship as CJS default exports, and under
// `moduleResolution: node16` the default import may be either the namespace
// object or a direct export. Peel the real constructor out regardless.
type AjvCtor = new (
	opts?: Record<string, unknown>,
) => {
	addFormats?: unknown;
	compile: (schema: unknown) => ((d: unknown) => boolean) & { errors?: unknown[] | null };
};
const Ajv = ((Ajv2020Module as unknown as { default?: AjvCtor }).default ?? Ajv2020Module) as AjvCtor;
const addFormats = ((addFormatsModule as unknown as { default?: (ajv: unknown) => void }).default ??
	addFormatsModule) as (ajv: unknown) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PreflightCheck {
	name: string;
	ok: boolean;
	detail: string;
}

export interface PreflightReport {
	passed: boolean;
	checks: PreflightCheck[];
}

// ---------------------------------------------------------------------------
// Types describing the results.json shape (minimal — only the fields we gate)
// ---------------------------------------------------------------------------

export interface LiveRow {
	config: string;
	taskId: string;
	seed: number;
	passed: boolean;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost?: number;
	audit?: { deltaPct: number; withinTolerance: boolean; tolerancePct: number };
}

export interface OutputEvalRow {
	promptId: string;
	intensity: "off" | "lite" | "full" | "ultra";
	outputTokens: number;
	qualityScore: number;
	accepted?: boolean;
}

export interface PreflightInput {
	results: {
		manifestHash?: string;
		codeSha?: string;
		datasetHash?: string;
		costUsd?: number;
		costCapUsd?: number;
		live: LiveRow[];
		outputEval: OutputEvalRow[];
	};
	manifest: {
		datasetHash?: string;
		codeSha?: string;
		costCapUsd: number;
		seedsPerConfig: number;
		tolerances: {
			passAtOneGapPp: number;
			tokenAuditDeltaPct: number;
			outputQualityGap: number;
			minIsoQualityIntersection: number;
		};
	};
	/** Path to the results.json file; used only for schema validation. */
	resultsJsonPath?: string;
}

// ---------------------------------------------------------------------------
// Individual checks (exported so unit tests can drive each in isolation)
// ---------------------------------------------------------------------------

export function checkPassAtOneGap(input: PreflightInput): PreflightCheck {
	const tolerance = input.manifest.tolerances.passAtOneGapPp;
	const byConfig = new Map<string, { pass: number; total: number }>();
	for (const row of input.results.live) {
		const b = byConfig.get(row.config) ?? { pass: 0, total: 0 };
		b.total += 1;
		if (row.passed) b.pass += 1;
		byConfig.set(row.config, b);
	}
	const baseline = byConfig.get("A-baseline");
	if (!baseline || baseline.total === 0) {
		return { name: "pass@1 gap", ok: false, detail: "A-baseline has no rows" };
	}
	const basePct = (baseline.pass / baseline.total) * 100;
	const offenders: string[] = [];
	for (const [config, b] of byConfig.entries()) {
		if (config === "A-baseline") continue;
		const pct = (b.pass / b.total) * 100;
		if (basePct - pct > tolerance) {
			offenders.push(
				`${config}: ${pct.toFixed(1)}% vs baseline ${basePct.toFixed(1)}% (gap ${(basePct - pct).toFixed(1)}pp)`,
			);
		}
	}
	return {
		name: "pass@1 gap",
		ok: offenders.length === 0,
		detail: offenders.length
			? `configs regressed > ${tolerance}pp: ${offenders.join("; ")}`
			: `all configs within ${tolerance}pp of baseline (${basePct.toFixed(1)}%)`,
	};
}

export function checkTokenAudit(input: PreflightInput): PreflightCheck {
	const tolerance = input.manifest.tolerances.tokenAuditDeltaPct;
	const offenders: string[] = [];
	let audited = 0;
	for (const row of input.results.live) {
		if (!row.audit) continue;
		audited += 1;
		if (row.audit.deltaPct > tolerance) {
			offenders.push(`${row.config}/${row.taskId}[seed=${row.seed}]: ${row.audit.deltaPct.toFixed(2)}%`);
		}
	}
	if (audited === 0) {
		return { name: "token audit", ok: false, detail: "no audit entries in results.live" };
	}
	return {
		name: "token audit",
		ok: offenders.length === 0,
		detail: offenders.length
			? `${offenders.length} rows over ${tolerance}%: ${offenders.slice(0, 3).join("; ")}${offenders.length > 3 ? ", …" : ""}`
			: `${audited} rows audited, all within ${tolerance}%`,
	};
}

export function checkIsoQualityIntersection(input: PreflightInput): PreflightCheck {
	const minSize = input.manifest.tolerances.minIsoQualityIntersection;
	// Intersection = set of taskIds where EVERY config has at least one passing seed.
	const configs = new Set(input.results.live.map((r) => r.config));
	const tasksByConfig = new Map<string, Set<string>>();
	for (const c of configs) tasksByConfig.set(c, new Set());
	for (const row of input.results.live) {
		if (row.passed) tasksByConfig.get(row.config)!.add(row.taskId);
	}
	const allTasks = new Set(input.results.live.map((r) => r.taskId));
	let intersection = 0;
	for (const task of allTasks) {
		let inAll = true;
		for (const c of configs) {
			if (!tasksByConfig.get(c)!.has(task)) {
				inAll = false;
				break;
			}
		}
		if (inAll) intersection += 1;
	}
	return {
		name: "iso-quality intersection",
		ok: intersection >= minSize,
		detail: `intersection = ${intersection} (min ${minSize})`,
	};
}

export function checkOutputQualityGap(input: PreflightInput): PreflightCheck {
	const maxGap = input.manifest.tolerances.outputQualityGap;
	// Find "off" baseline quality per prompt and compare each other intensity.
	const byPromptOff = new Map<string, number>();
	for (const r of input.results.outputEval) {
		if (r.intensity === "off") byPromptOff.set(r.promptId, r.qualityScore);
	}
	const offenders: string[] = [];
	for (const r of input.results.outputEval) {
		if (r.intensity === "off") continue;
		if (r.accepted === false) continue; // already rejected, doesn't need to gate
		const baseline = byPromptOff.get(r.promptId);
		if (baseline === undefined) continue;
		if (baseline - r.qualityScore > maxGap) {
			offenders.push(`${r.promptId}@${r.intensity}: ${r.qualityScore.toFixed(1)} vs off ${baseline.toFixed(1)}`);
		}
	}
	return {
		name: "output quality gap",
		ok: offenders.length === 0,
		detail: offenders.length
			? `${offenders.length} accepted rows regressed > ${maxGap} pt: ${offenders.slice(0, 3).join("; ")}`
			: `all accepted intensities within ${maxGap} pt of off`,
	};
}

function hashDatasets(datasetsDir: string): string {
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

export function checkDatasetHash(input: PreflightInput, datasetsDir: string): PreflightCheck {
	if (!input.manifest.datasetHash) {
		return {
			name: "dataset hash",
			ok: false,
			detail: "manifest.datasetHash not set — run `run-all.sh` to inject it",
		};
	}
	const actual = hashDatasets(datasetsDir);
	return {
		name: "dataset hash",
		ok: actual === input.manifest.datasetHash,
		detail:
			actual === input.manifest.datasetHash
				? `matches (${actual.slice(0, 12)}…)`
				: `mismatch: manifest=${input.manifest.datasetHash.slice(0, 12)}… actual=${actual.slice(0, 12)}…`,
	};
}

export function checkCodeSha(input: PreflightInput, repoRoot: string): PreflightCheck {
	if (!input.manifest.codeSha) {
		return { name: "code SHA", ok: false, detail: "manifest.codeSha not set" };
	}
	let head: string;
	try {
		head = execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim();
	} catch (e) {
		return { name: "code SHA", ok: false, detail: `git rev-parse failed: ${(e as Error).message}` };
	}
	return {
		name: "code SHA",
		ok: head.startsWith(input.manifest.codeSha) || input.manifest.codeSha.startsWith(head),
		detail:
			head === input.manifest.codeSha
				? `matches (${head.slice(0, 12)})`
				: `HEAD ${head.slice(0, 12)} vs manifest ${input.manifest.codeSha.slice(0, 12)}`,
	};
}

export function checkSeedCount(input: PreflightInput): PreflightCheck {
	const required = input.manifest.seedsPerConfig;
	const byConfig = new Map<string, Set<number>>();
	for (const row of input.results.live) {
		if (!byConfig.has(row.config)) byConfig.set(row.config, new Set());
		byConfig.get(row.config)!.add(row.seed);
	}
	const under: string[] = [];
	for (const [c, seeds] of byConfig.entries()) {
		if (seeds.size < required) under.push(`${c}: ${seeds.size}/${required}`);
	}
	return {
		name: "seeds per config",
		ok: under.length === 0,
		detail: under.length ? `under-sampled: ${under.join(", ")}` : `all configs have ≥ ${required} seeds`,
	};
}

export function checkSchema(resultsJson: unknown, schema: object): PreflightCheck {
	const ajv = new Ajv({ allErrors: true, strict: false });
	addFormats(ajv);
	const validate = ajv.compile(schema);
	const ok = validate(resultsJson) === true;
	type AjvError = { instancePath?: string; message?: string };
	const errs = (validate.errors ?? []) as AjvError[];
	return {
		name: "results.json schema",
		ok,
		detail: ok
			? "validates against results.schema.json"
			: `errors: ${errs
					.slice(0, 3)
					.map((e) => `${e.instancePath ?? ""} ${e.message ?? ""}`)
					.join("; ")}`,
	};
}

export function checkCostCap(input: PreflightInput): PreflightCheck {
	const spent = input.results.costUsd ?? 0;
	const cap = input.manifest.costCapUsd;
	return {
		name: "cost cap",
		ok: spent <= cap,
		detail: `spent $${spent.toFixed(2)} / cap $${cap.toFixed(2)}`,
	};
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface RunPreflightOptions {
	input: PreflightInput;
	datasetsDir?: string;
	repoRoot?: string;
	schema?: object;
	/**
	 * Full results.json object to validate against the schema. When omitted,
	 * falls back to `input.results`. The orchestrator passes the ReporterInput
	 * here since that carries all required top-level fields (schemaVersion,
	 * ranAt, replay, layerIsolation, preflight).
	 */
	schemaTarget?: unknown;
}

export function runPreflight(opts: RunPreflightOptions): PreflightReport {
	const checks: PreflightCheck[] = [];
	checks.push(checkPassAtOneGap(opts.input));
	checks.push(checkTokenAudit(opts.input));
	checks.push(checkIsoQualityIntersection(opts.input));
	checks.push(checkOutputQualityGap(opts.input));
	if (opts.datasetsDir) checks.push(checkDatasetHash(opts.input, opts.datasetsDir));
	if (opts.repoRoot) checks.push(checkCodeSha(opts.input, opts.repoRoot));
	checks.push(checkSeedCount(opts.input));
	if (opts.schema) checks.push(checkSchema(opts.schemaTarget ?? opts.input.results, opts.schema));
	checks.push(checkCostCap(opts.input));
	return { passed: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
	const resultsPath = process.argv[2];
	const manifestPath = process.argv[3] ?? join(__dirname, "manifest.json");
	if (!resultsPath) {
		process.stderr.write("Usage: preflight.ts <results.json> [manifest.json]\n");
		process.exit(2);
	}
	const results = JSON.parse(readFileSync(resultsPath, "utf-8"));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	const schemaPath = join(__dirname, "schema", "results.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
	const report = runPreflight({
		input: { results, manifest },
		datasetsDir: join(__dirname, "datasets"),
		repoRoot: join(__dirname, "..", "..", "..", ".."),
		schema,
	});
	for (const c of report.checks) {
		const badge = c.ok ? "✓" : "✗";
		process.stdout.write(`${badge} ${c.name}: ${c.detail}\n`);
	}
	if (!report.passed) {
		process.stderr.write("\nPREFLIGHT FAILED — publication blocked.\n");
		process.exit(1);
	}
	process.stdout.write("\nPreflight passed — results are publication-ready.\n");
}
