import { spawn } from "node:child_process";
import type { ContextBundle, ContextEngine, ContextHealth, ContextPack, ContextQuery } from "../context-engine.js";

export type QmdState =
	| "missing-binary"
	| "schema-mismatch"
	| "permission-denied"
	| "timeout"
	| "malformed-result"
	| "adapter-error"
	| "ok";

export class QmdContextError extends Error {
	constructor(
		readonly state: QmdState,
		message: string,
	) {
		super(message);
		this.name = "QmdContextError";
	}
}

export interface QmdContextEngineOptions {
	command?: string;
	maxResults?: number;
	collections?: string[];
}

interface QmdSearchResult {
	docid: string;
	file: string;
	snippet: string;
	score?: number;
	line?: number;
	title?: string;
	context?: string;
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

function validateSearchResult(value: unknown): QmdSearchResult | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.docid !== "string") return undefined;
	if (typeof item.file !== "string") return undefined;
	if (typeof item.snippet !== "string") return undefined;
	const score = optionalNumber(item, "score");
	const line = optionalNumber(item, "line");
	const title = optionalString(item, "title");
	const context = optionalString(item, "context");
	if (score === false || line === false || title === false || context === false) return undefined;
	return { docid: item.docid, file: item.file, snippet: item.snippet, score, line, title, context };
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
			finish(() => reject(new QmdContextError("timeout", "qmd query aborted")));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > 2_000_000) {
				child.kill();
				finish(() => reject(new QmdContextError("malformed-result", "qmd output exceeded cap")));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			const state: QmdState =
				error.code === "ENOENT"
					? "missing-binary"
					: error.code === "EACCES"
						? "permission-denied"
						: "adapter-error";
			finish(() => reject(new QmdContextError(state, error.message)));
		});
		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(new QmdContextError("adapter-error", stderr.trim() || `qmd exited ${code}`));
					return;
				}
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					reject(new QmdContextError("schema-mismatch", "qmd returned non-JSON output"));
				}
			});
		});
	});
}

export function mapQmdResult(result: QmdSearchResult): ContextBundle {
	const id = `qmd:${result.docid}`;
	return {
		id,
		source: "qmd",
		entityType: "memory",
		title: result.title ?? result.file,
		content: result.snippet,
		score: result.score,
		provenance: {
			path: result.file,
			startLine: result.line,
			memoryId: result.docid,
		},
		retrievalHandle: {
			type: "qmd",
			id: result.docid,
		},
	};
}

export class QmdContextEngine implements ContextEngine {
	readonly name = "qmd";
	private readonly command: string;
	private readonly maxResults: number;
	private readonly collections: string[];

	constructor(options: QmdContextEngineOptions = {}) {
		this.command = options.command ?? "qmd";
		this.maxResults = options.maxResults ?? 5;
		this.collections = options.collections ?? [];
	}

	async health(): Promise<ContextHealth> {
		return { enabled: true, provider: "qmd", ok: true, detail: `command=${this.command}` };
	}

	statusDetail(): string {
		const collections = this.collections.length > 0 ? this.collections.join(",") : "<default>";
		return `command=${this.command} collections=${collections} mode=query --no-rerank`;
	}

	async retrieve(query: ContextQuery): Promise<ContextPack> {
		if (!query.includeMemory) return { bundles: [], sources: { qmd: { ok: true, detail: "includeMemory=false" } } };
		const args = [
			"query",
			query.normalizedUserPrompt ?? query.rawUserPrompt,
			"--json",
			"--no-rerank",
			"-n",
			String(this.maxResults),
		];
		for (const collection of this.collections) {
			args.push("-c", collection);
		}
		const raw = await runJsonCommand(this.command, args, query.signal);
		if (!Array.isArray(raw)) {
			throw new QmdContextError("schema-mismatch", "qmd query did not return an array");
		}

		const valid: QmdSearchResult[] = [];
		let malformed = 0;
		for (const value of raw) {
			const result = validateSearchResult(value);
			if (!result) {
				malformed++;
				continue;
			}
			valid.push(result);
		}
		if (malformed > 0 && valid.length === 0) {
			throw new QmdContextError("malformed-result", "all qmd results were malformed");
		}

		const bundles = valid.map(mapQmdResult);
		return {
			bundles,
			sources: {
				qmd: {
					ok: true,
					detail: `results=${raw.length} bundles=${bundles.length} malformed=${malformed} ${this.statusDetail()}`,
				},
			},
		};
	}
}
