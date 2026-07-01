import { spawn } from "node:child_process";
import type { ContextBundle, ContextEngine, ContextHealth, ContextPack, ContextQuery } from "../context-engine.js";

export type GbrainState =
	| "disabled"
	| "missing-binary"
	| "unsupported-version"
	| "schema-mismatch"
	| "permission-denied"
	| "timeout"
	| "malformed-result"
	| "adapter-error"
	| "no-results"
	| "scope-required"
	| "ok";

export class GbrainContextError extends Error {
	constructor(
		readonly state: GbrainState,
		message: string,
	) {
		super(message);
		this.name = "GbrainContextError";
	}
}

export interface GbrainContextEngineOptions {
	command?: string;
	maxResults?: number;
	project?: string;
	allowedPrefixes?: string[];
	disallowPrefixes?: string[];
	allowAllMemory?: boolean;
}

interface GbrainSearchResult {
	slug: string;
	page_id?: number;
	title?: string;
	type?: string;
	chunk_text: string;
	chunk_id?: number;
	chunk_index?: number;
	score?: number;
	stale?: boolean;
	source_id?: string;
	effective_date?: string;
}

function optionalString(item: Record<string, unknown>, key: string): string | undefined | false {
	const value = item[key];
	if (value === undefined || value === null) return undefined;
	return typeof value === "string" ? value : false;
}

function optionalNumber(item: Record<string, unknown>, key: string): number | undefined | false {
	const value = item[key];
	if (value === undefined || value === null) return undefined;
	return typeof value === "number" ? value : false;
}

function optionalBoolean(item: Record<string, unknown>, key: string): boolean | undefined | "invalid" {
	const value = item[key];
	if (value === undefined || value === null) return undefined;
	return typeof value === "boolean" ? value : "invalid";
}

function validateSearchResult(value: unknown): GbrainSearchResult | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.slug !== "string") return undefined;
	if (typeof item.chunk_text !== "string") return undefined;

	const pageId = optionalNumber(item, "page_id");
	const title = optionalString(item, "title");
	const type = optionalString(item, "type");
	const chunkId = optionalNumber(item, "chunk_id");
	const chunkIndex = optionalNumber(item, "chunk_index");
	const score = optionalNumber(item, "score");
	const stale = optionalBoolean(item, "stale");
	const sourceId = optionalString(item, "source_id");
	const effectiveDate = optionalString(item, "effective_date");
	if (
		pageId === false ||
		title === false ||
		type === false ||
		chunkId === false ||
		chunkIndex === false ||
		score === false ||
		stale === "invalid" ||
		sourceId === false ||
		effectiveDate === false
	) {
		return undefined;
	}

	return {
		slug: item.slug,
		chunk_text: item.chunk_text,
		page_id: pageId,
		title,
		type,
		chunk_id: chunkId,
		chunk_index: chunkIndex,
		score,
		stale,
		source_id: sourceId,
		effective_date: effectiveDate,
	};
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
			finish(() => reject(new GbrainContextError("timeout", "gbrain context query aborted")));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > 2_000_000) {
				child.kill();
				finish(() => reject(new GbrainContextError("malformed-result", "gbrain output exceeded cap")));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			const state: GbrainState =
				error.code === "ENOENT"
					? "missing-binary"
					: error.code === "EACCES"
						? "permission-denied"
						: "adapter-error";
			finish(() => reject(new GbrainContextError(state, error.message)));
		});
		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					const detail = stderr.trim() || `gbrain exited ${code}`;
					const state: GbrainState = /unknown command|context-query|unrecognized/i.test(detail)
						? "unsupported-version"
						: "adapter-error";
					reject(new GbrainContextError(state, detail));
					return;
				}
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					reject(new GbrainContextError("schema-mismatch", "gbrain returned non-JSON output"));
				}
			});
		});
	});
}

function matchesPrefix(slug: string, prefix: string): boolean {
	const normalized = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
	return slug === normalized || slug.startsWith(`${normalized}/`);
}

function isAllowedByScope(
	result: GbrainSearchResult,
	options: { project?: string; allowedPrefixes: string[]; disallowPrefixes: string[] },
): boolean {
	if (options.disallowPrefixes.some((prefix) => matchesPrefix(result.slug, prefix))) return false;
	if (options.project && !matchesPrefix(result.slug, `projects/${options.project}`)) return false;
	if (options.allowedPrefixes.length === 0) return true;
	return options.allowedPrefixes.some((prefix) => matchesPrefix(result.slug, prefix));
}

function entityTypeForResult(result: GbrainSearchResult): "doc" | "memory" {
	if (result.type === "memory" || result.type === "fact") return "memory";
	if (/^(people|companies|concepts|originals)\//.test(result.slug)) return "memory";
	return "doc";
}

export function mapGbrainResult(result: GbrainSearchResult): ContextBundle {
	const sourceId = result.source_id ?? "default";
	const handleId = `${sourceId}::${result.slug}${result.chunk_id !== undefined ? `#${result.chunk_id}` : ""}`;
	return {
		id: `gbrain:${handleId}`,
		source: "gbrain",
		entityType: entityTypeForResult(result),
		title: result.title ?? result.slug,
		content: result.chunk_text,
		score: result.score,
		provenance: {
			path: result.slug,
			memoryId: String(result.page_id ?? result.slug),
		},
		retrievalHandle: {
			type: "gbrain",
			id: handleId,
		},
		freshness: {
			indexedAt: result.effective_date,
			stale: Boolean(result.stale),
		},
	};
}

export class GbrainContextEngine implements ContextEngine {
	readonly name = "gbrain";
	private readonly command: string;
	private readonly maxResults: number;
	private readonly project: string | undefined;
	private readonly allowedPrefixes: string[];
	private readonly disallowPrefixes: string[];
	private readonly allowAllMemory: boolean;

	constructor(options: GbrainContextEngineOptions = {}) {
		this.command = options.command ?? "gbrain";
		this.maxResults = options.maxResults ?? 5;
		this.project = options.project;
		this.allowedPrefixes = options.allowedPrefixes ?? [];
		this.disallowPrefixes = options.disallowPrefixes ?? ["notes"];
		this.allowAllMemory = options.allowAllMemory ?? true;
	}

	scopeSummary(): string {
		const allow =
			this.allowedPrefixes.length > 0 ? this.allowedPrefixes.join(",") : this.allowAllMemory ? "<all>" : "<none>";
		const deny = this.disallowPrefixes.length > 0 ? this.disallowPrefixes.join(",") : "<none>";
		const project = this.project ?? "<none>";
		return `allowAllMemory=${this.allowAllMemory}; allow=${allow}; deny=${deny}; project=${project}`;
	}

	async health(): Promise<ContextHealth> {
		return { enabled: true, provider: "gbrain", ok: true, detail: `command=${this.command}` };
	}

	async retrieve(query: ContextQuery): Promise<ContextPack> {
		if (!query.includeMemory)
			return { bundles: [], sources: { gbrain: { ok: true, detail: "includeMemory=false" } } };
		if (!this.allowAllMemory && this.allowedPrefixes.length === 0) {
			throw new GbrainContextError("scope-required", "configure gbrain allowedPrefixes or set allowAllMemory=true");
		}
		const args = [
			"context-query",
			"--json",
			query.normalizedUserPrompt ?? query.rawUserPrompt,
			"--limit",
			String(this.maxResults),
		];
		if (this.project) args.push("--project", this.project);
		for (const prefix of this.allowedPrefixes) {
			args.push("--prefix", prefix);
		}
		for (const prefix of this.disallowPrefixes) {
			args.push("--exclude-prefix", prefix);
		}

		const raw = await runJsonCommand(this.command, args, query.signal);
		if (!Array.isArray(raw)) {
			throw new GbrainContextError("schema-mismatch", "gbrain context query did not return an array");
		}

		const valid: GbrainSearchResult[] = [];
		let malformed = 0;
		let skippedScope = 0;
		for (const value of raw) {
			const result = validateSearchResult(value);
			if (!result) {
				malformed++;
				continue;
			}
			if (
				!isAllowedByScope(result, {
					project: this.project,
					allowedPrefixes: this.allowedPrefixes,
					disallowPrefixes: this.disallowPrefixes,
				})
			) {
				skippedScope++;
				continue;
			}
			valid.push(result);
		}
		if (malformed > 0 && valid.length === 0) {
			throw new GbrainContextError("malformed-result", "all gbrain results were malformed");
		}

		const bundles = valid.map(mapGbrainResult);
		return {
			bundles,
			sources: {
				gbrain: {
					ok: true,
					detail: `results=${raw.length} bundles=${bundles.length} skipped_scope=${skippedScope} malformed=${malformed} scope=${this.scopeSummary()}`,
				},
			},
		};
	}
}
