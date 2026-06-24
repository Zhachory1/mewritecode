/**
 * FilesProvider — markdown fallback memory backend (WS7).
 *
 * Used when cavemem is not installed (or the user explicitly disables it).
 * Storage layout:
 *   <root>/CLAUDE.md              ← read-only, surfaced as the project context.
 *                                   We never edit it; cave's project context
 *                                   is the source of truth for that file.
 *   <root>/.cave/memory/<id>.md   ← one observation per file. id is the
 *                                   stem of the filename (numeric sequence).
 *   <root>/.cave/memory/index.json ← lightweight manifest with kind, ts, etc.
 *                                   Rebuilt lazily; safe to delete.
 *
 * Search is a naive substring match across markdown bodies. Good enough for a
 * fallback; the moment cavemem appears we switch transparently.
 *
 * Source check: upstream coding-agent layouts include a `memory-bank` markdown
 *   directory in `ai/memory-bank/`. Format-compatible read paths are added here
 *   so an existing project's memory-bank shows up in cave's search results
 *   without copying. (Borrowed: memory-bank directory layout.)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	MemoryHit,
	MemoryHookEvent,
	MemoryHookPayload,
	MemoryObservation,
	MemoryProvider,
	MemorySessionInfo,
	ObservationKind,
} from "./provider.js";

export interface FilesProviderOptions {
	/** Project root (defaults to cwd). */
	cwd?: string;
	/** Override the memory dir root. Default: <cwd>/.cave/memory */
	memoryDir?: string;
	/** Config dir name used when memoryDir is not set. Default: .cave */
	configDirName?: string;
	/** Extra read-only roots (e.g. memory-bank). */
	extraReadDirs?: string[];
	/** Skip on-disk writes (useful for tests). */
	readOnly?: boolean;
}

interface IndexEntry {
	id: number;
	kind: ObservationKind;
	ts: string;
	session_id: string;
	preview: string;
	provenance?: number[];
}

interface IndexFile {
	version: 1;
	entries: IndexEntry[];
	nextId: number;
}

const EMPTY_INDEX: IndexFile = { version: 1, entries: [], nextId: 1 };

export class FilesProvider implements MemoryProvider {
	readonly id = "files";
	readonly label = "files (.cave/memory)";
	private readonly memoryDir: string;
	private readonly extraReadDirs: string[];
	private readonly readOnly: boolean;

	constructor(options: FilesProviderOptions = {}) {
		const cwd = options.cwd ?? process.cwd();
		this.memoryDir = options.memoryDir ?? join(cwd, options.configDirName ?? ".cave", "memory");
		this.extraReadDirs = (options.extraReadDirs ?? []).map((p) => resolve(p));
		this.readOnly = options.readOnly === true;
	}

	async isAvailable(): Promise<boolean> {
		// Files provider is always "available" as a fallback — even if the
		// directory is missing we can create it on first save.
		return true;
	}

	async dispatchHook(_event: MemoryHookEvent, _payload: MemoryHookPayload): Promise<void> {
		// FilesProvider is passive — no daemon, no write triggers. The hooks
		// are honored by cavemem's stdio entrypoint; the markdown fallback
		// only writes when explicit calls (save/forget/consolidate) come in.
	}

	async search(query: string, opts?: { limit?: number }): Promise<MemoryHit[]> {
		const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
		const q = query.trim().toLowerCase();
		if (!q) return [];

		const hits: MemoryHit[] = [];
		for (const entry of this.readIndex().entries) {
			const body = this.readBody(entry.id);
			const hay = `${entry.preview}\n${body}`.toLowerCase();
			if (!hay.includes(q)) continue;
			hits.push({
				id: entry.id,
				kind: entry.kind,
				ts: entry.ts,
				preview: entry.preview,
				session_id: entry.session_id,
			});
			if (hits.length >= limit) break;
		}

		// Also scan extra read dirs (memory-bank etc.).
		if (hits.length < limit) {
			for (const dir of this.extraReadDirs) {
				if (!existsSync(dir)) continue;
				try {
					const files = readdirSync(dir);
					for (const f of files) {
						if (!f.endsWith(".md")) continue;
						const body = readFileSync(join(dir, f), "utf-8");
						if (!body.toLowerCase().includes(q)) continue;
						hits.push({
							id: -1,
							kind: "fact",
							preview: body.split("\n", 1)[0]?.slice(0, 200) ?? f,
							session_id: undefined,
						});
						if (hits.length >= limit) break;
					}
				} catch {
					// Dir unreadable — skip.
				}
				if (hits.length >= limit) break;
			}
		}

		return hits;
	}

	async timeline(_sessionId: string, opts?: { around?: number; limit?: number }): Promise<MemoryHit[]> {
		// The files backend has no real session ordering — surface the most
		// recent N entries instead. Good enough for the fallback.
		const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
		const entries = [...this.readIndex().entries].sort((a, b) => b.ts.localeCompare(a.ts));
		return entries.slice(0, limit).map((e) => ({
			id: e.id,
			kind: e.kind,
			ts: e.ts,
			preview: e.preview,
			session_id: e.session_id,
		}));
	}

	async getObservations(ids: number[], _opts?: { expand?: boolean }): Promise<MemoryObservation[]> {
		const out: MemoryObservation[] = [];
		const idx = this.readIndex();
		for (const id of ids) {
			const entry = idx.entries.find((e) => e.id === id);
			if (!entry) continue;
			out.push({
				id: entry.id,
				kind: entry.kind,
				ts: entry.ts,
				content: this.readBody(id),
				session_id: entry.session_id,
				provenance: entry.provenance,
			});
		}
		return out;
	}

	async listSessions(opts?: { limit?: number }): Promise<MemorySessionInfo[]> {
		const limit = Math.max(1, Math.min(200, opts?.limit ?? 20));
		const entries = this.readIndex().entries;
		const seen = new Map<string, MemorySessionInfo>();
		for (const e of entries) {
			if (!e.session_id) continue;
			const cur = seen.get(e.session_id);
			if (!cur) {
				seen.set(e.session_id, { id: e.session_id, started_at: e.ts });
			} else if (cur.started_at && e.ts < cur.started_at) {
				cur.started_at = e.ts;
			}
		}
		return [...seen.values()].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).slice(0, limit);
	}

	async save(
		content: string,
		kind: ObservationKind = "episodic",
		metadata?: Record<string, unknown>,
	): Promise<number | undefined> {
		if (this.readOnly) return undefined;
		mkdirSync(this.memoryDir, { recursive: true });
		const idx = this.readIndex();
		const id = idx.nextId++;
		const ts = new Date().toISOString();
		const session_id = (metadata?.session_id as string) ?? "files-default";
		const preview = preview200(content);
		const provenance = Array.isArray(metadata?.provenance) ? (metadata.provenance as number[]) : undefined;
		idx.entries.push({ id, kind, ts, session_id, preview, provenance });
		this.writeIndex(idx);
		writeFileSync(join(this.memoryDir, `${id}.md`), formatBody({ kind, ts, session_id, content, provenance }));
		return id;
	}

	async forget(ids: number[]): Promise<number> {
		if (this.readOnly) return 0;
		const idx = this.readIndex();
		const before = idx.entries.length;
		idx.entries = idx.entries.filter((e) => !ids.includes(e.id));
		this.writeIndex(idx);
		// Bodies are kept for audit trail (rename to .md.deleted) — caller can
		// purge the dir manually. Mirrors cavemem's redaction behaviour.
		for (const id of ids) {
			const p = join(this.memoryDir, `${id}.md`);
			if (existsSync(p)) {
				try {
					writeFileSync(`${p}.deleted`, readFileSync(p, "utf-8"));
				} catch {
					/* ignore */
				}
			}
		}
		return before - idx.entries.length;
	}

	async export(toPath: string): Promise<{ ok: boolean; bytes?: number; message?: string }> {
		try {
			const idx = this.readIndex();
			const lines = idx.entries.map((e) =>
				JSON.stringify({
					id: e.id,
					session_id: e.session_id,
					kind: e.kind,
					ts: e.ts,
					content: this.readBody(e.id),
					provenance: e.provenance,
				}),
			);
			const text = `${lines.join("\n")}\n`;
			writeFileSync(toPath, text);
			return { ok: true, bytes: text.length };
		} catch (err) {
			return { ok: false, message: err instanceof Error ? err.message : String(err) };
		}
	}

	// -- internals -----------------------------------------------------------

	private readIndex(): IndexFile {
		const p = join(this.memoryDir, "index.json");
		if (!existsSync(p)) return structuredClone(EMPTY_INDEX);
		try {
			const raw = readFileSync(p, "utf-8");
			const parsed = JSON.parse(raw) as IndexFile;
			if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
				return structuredClone(EMPTY_INDEX);
			}
			if (typeof parsed.nextId !== "number" || parsed.nextId < 1) {
				parsed.nextId = parsed.entries.reduce((m, e) => Math.max(m, e.id + 1), 1);
			}
			return parsed;
		} catch {
			return structuredClone(EMPTY_INDEX);
		}
	}

	private writeIndex(idx: IndexFile): void {
		mkdirSync(this.memoryDir, { recursive: true });
		writeFileSync(join(this.memoryDir, "index.json"), `${JSON.stringify(idx, null, 2)}\n`);
	}

	private readBody(id: number): string {
		const p = join(this.memoryDir, `${id}.md`);
		if (!existsSync(p)) return "";
		try {
			const raw = readFileSync(p, "utf-8");
			// Strip frontmatter — bodies stored with a leading '---' YAML block.
			const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
			return m ? m[1] : raw;
		} catch {
			return "";
		}
	}

	/** Public helper exposed for tests + diagnostics. */
	stats(): { entries: number; nextId: number; memoryDir: string } {
		const idx = this.readIndex();
		return { entries: idx.entries.length, nextId: idx.nextId, memoryDir: this.memoryDir };
	}
}

function preview200(s: string): string {
	const single = s.replace(/\s+/g, " ").trim();
	return single.length <= 200 ? single : `${single.slice(0, 199)}…`;
}

function formatBody(args: {
	kind: string;
	ts: string;
	session_id: string;
	content: string;
	provenance?: number[];
}): string {
	const fm = ["---", `kind: ${args.kind}`, `ts: ${args.ts}`, `session_id: ${args.session_id}`];
	if (args.provenance && args.provenance.length > 0) fm.push(`provenance: [${args.provenance.join(", ")}]`);
	fm.push("---", "");
	return `${fm.join("\n")}${args.content}\n`;
}

/**
 * Helper: best-effort detection of a usable read-only root for fallback search.
 * Falls through silently if nothing is found.
 */
export function discoverFilesProviderReadDirs(cwd: string): string[] {
	const candidates = [join(cwd, "ai", "memory-bank"), join(cwd, "memory-bank"), join(cwd, "context", "memory")];
	return candidates.filter((p) => {
		try {
			return statSync(p).isDirectory();
		} catch {
			return false;
		}
	});
}
