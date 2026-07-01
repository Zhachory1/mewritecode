import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ContextBundle, ContextEngine, ContextHealth, ContextPack, ContextQuery } from "../context-engine.js";

export type RepoIndexState =
	| "disabled"
	| "missing-binary"
	| "unsupported-version"
	| "schema-mismatch"
	| "no-indexed-repo"
	| "db-unreadable"
	| "permission-denied"
	| "timeout"
	| "malformed-result"
	| "adapter-error"
	| "all-results-stale-or-dirty"
	| "ok";

export class RepoIndexContextError extends Error {
	constructor(
		readonly state: RepoIndexState,
		message: string,
	) {
		super(message);
		this.name = "RepoIndexContextError";
	}
}

export interface RepoIndexContextEngineOptions {
	cwd: string;
	command?: string;
	dbPath?: string;
	k?: number;
}

interface RepoIndexSearchResult {
	repo: string;
	path: string;
	start_line: number;
	end_line: number;
	snippet: string;
	score: number;
	language: string;
	symbol_name?: string | null;
	symbol_kind?: string | null;
	symbol_line?: number | null;
	symbol_confidence?: string | null;
	is_stale?: boolean;
	has_dirty_tracked_files?: boolean;
}

function expandHome(path: string | undefined): string | undefined {
	if (!path) return undefined;
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
	return path;
}

function repoPath(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return resolve(cwd);
	}
}

function validateSearchResult(value: unknown): RepoIndexSearchResult | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.repo !== "string") return undefined;
	if (typeof item.path !== "string") return undefined;
	if (typeof item.start_line !== "number") return undefined;
	if (typeof item.end_line !== "number") return undefined;
	if (typeof item.snippet !== "string") return undefined;
	if (typeof item.score !== "number") return undefined;
	if (typeof item.language !== "string") return undefined;
	return item as unknown as RepoIndexSearchResult;
}

function runJsonCommand(command: string, args: string[], signal: AbortSignal | undefined): Promise<unknown> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => {
			child.kill();
			finish(() => reject(new RepoIndexContextError("timeout", "codescry query aborted")));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > 2_000_000) {
				child.kill();
				finish(() => reject(new RepoIndexContextError("malformed-result", "codescry output exceeded cap")));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			const state: RepoIndexState =
				error.code === "ENOENT"
					? "missing-binary"
					: error.code === "EACCES"
						? "permission-denied"
						: "adapter-error";
			finish(() => reject(new RepoIndexContextError(state, error.message)));
		});
		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(new RepoIndexContextError("adapter-error", stderr.trim() || `codescry exited ${code}`));
					return;
				}
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					reject(new RepoIndexContextError("schema-mismatch", "codescry returned non-JSON output"));
				}
			});
		});
	});
}

export function mapRepoIndexResult(result: RepoIndexSearchResult): ContextBundle | undefined {
	if (result.is_stale || result.has_dirty_tracked_files) return undefined;
	const id = `codescry:${result.repo}:${result.path}:${result.start_line}-${result.end_line}`;
	return {
		id,
		source: "codescry",
		entityType: result.symbol_name ? "symbol" : "code-chunk",
		title: result.symbol_name ? `${result.symbol_kind ?? "symbol"} ${result.symbol_name}` : result.path,
		content: result.snippet,
		score: result.score,
		provenance: {
			path: result.path,
			startLine: result.start_line,
			endLine: result.end_line,
		},
		retrievalHandle: {
			type: "codescry",
			id,
		},
		freshness: {
			stale: Boolean(result.is_stale),
			dirty: Boolean(result.has_dirty_tracked_files),
		},
	};
}

export class RepoIndexContextEngine implements ContextEngine {
	readonly name = "codescry";
	private readonly command: string;
	private readonly dbPath: string | undefined;
	private readonly k: number;
	private readonly cwd: string;

	constructor(options: RepoIndexContextEngineOptions) {
		this.command = options.command ?? "codescry";
		this.dbPath = expandHome(options.dbPath);
		this.k = options.k ?? 8;
		this.cwd = options.cwd;
	}

	async health(): Promise<ContextHealth> {
		return { enabled: true, provider: "codescry", ok: true, detail: `command=${this.command}` };
	}

	async retrieve(query: ContextQuery): Promise<ContextPack> {
		if (!query.includeCode) return { bundles: [], sources: { codescry: { ok: true, detail: "includeCode=false" } } };
		const args: string[] = [];
		if (this.dbPath) args.push("--db", this.dbPath);
		args.push(
			"query",
			query.normalizedUserPrompt ?? query.rawUserPrompt,
			"--repo",
			repoPath(this.cwd),
			"-k",
			String(this.k),
		);
		const raw = await runJsonCommand(this.command, args, query.signal);
		if (!Array.isArray(raw)) {
			throw new RepoIndexContextError("schema-mismatch", "codescry query did not return an array");
		}
		const valid: RepoIndexSearchResult[] = [];
		let malformed = 0;
		let stale = 0;
		let dirty = 0;
		for (const value of raw) {
			const result = validateSearchResult(value);
			if (!result) {
				malformed++;
				continue;
			}
			if (result.is_stale) stale++;
			if (result.has_dirty_tracked_files) dirty++;
			valid.push(result);
		}
		if (malformed > 0 && valid.length === 0) {
			throw new RepoIndexContextError("malformed-result", "all codescry results were malformed");
		}
		const bundles = valid.map(mapRepoIndexResult).filter((bundle): bundle is ContextBundle => bundle !== undefined);
		if (bundles.length === 0 && valid.length > 0) {
			throw new RepoIndexContextError("all-results-stale-or-dirty", `stale=${stale} dirty=${dirty}`);
		}
		return {
			bundles,
			sources: {
				codescry: {
					ok: true,
					detail: `results=${raw.length} bundles=${bundles.length} stale=${stale} dirty=${dirty} malformed=${malformed}`,
				},
			},
		};
	}
}
