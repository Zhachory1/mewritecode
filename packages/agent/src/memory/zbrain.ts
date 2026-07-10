import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

export interface ZbrainProviderOptions {
	command?: string;
	workspace?: string;
	defaultCollection?: string;
	spawnImpl?: typeof spawn;
	existsImpl?: (path: string) => boolean;
	now?: () => Date;
}

interface ZbrainExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface ZbrainSearchResult {
	rank?: number;
	id?: string;
	path?: string;
	score?: number;
	title?: string;
	lineStart?: number;
	lineEnd?: number;
	snippet?: string;
}

interface ZbrainStatus {
	dbExists?: boolean;
	dbPath?: string;
	documents?: number;
	chunks?: number;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
	return path;
}

function safeSlug(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "memory";
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

export class ZbrainProvider implements MemoryProvider {
	readonly id = "zbrain";
	readonly label = "zbrain";

	private readonly command: string;
	private readonly workspace: string;
	private readonly defaultCollection: string;
	private readonly spawnImpl: typeof spawn;
	private readonly existsImpl: (path: string) => boolean;
	private readonly now: () => Date;
	private readonly idToDocument = new Map<number, string>();

	constructor(options: ZbrainProviderOptions = {}) {
		this.command = options.command ?? "zbrain";
		this.workspace = resolve(expandHome(options.workspace ?? "~/.zbrain"));
		this.defaultCollection = options.defaultCollection ?? "inbox";
		this.spawnImpl = options.spawnImpl ?? spawn;
		this.existsImpl = options.existsImpl ?? existsSync;
		this.now = options.now ?? (() => new Date());
	}

	async isAvailable(): Promise<boolean> {
		if (!this.existsImpl(this.workspace)) return false;
		const result = await this.exec(["status", "--json"]).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
		return result.exitCode === 0;
	}

	async status(): Promise<ZbrainStatus> {
		const result = await this.exec(["status", "--json"]);
		if (result.exitCode !== 0) return {};
		const parsed = JSON.parse(result.stdout) as { status?: ZbrainStatus };
		return parsed.status ?? {};
	}

	async dispatchHook(_event: MemoryHookEvent, _payload: MemoryHookPayload): Promise<void> {
		// zbrain is explicit read/write memory. Do not auto-capture lifecycle events.
	}

	async search(query: string, opts?: { limit?: number }): Promise<MemoryHit[]> {
		if (!query.trim()) return [];
		const limit = Math.max(1, Math.min(20, opts?.limit ?? 5));
		const result = await this.exec(["search", query, "--limit", String(limit), "--json"]);
		if (result.exitCode !== 0) return [];
		const parsed = JSON.parse(result.stdout) as { results?: ZbrainSearchResult[] };
		const rows = parsed.results ?? [];
		this.idToDocument.clear();
		return rows.map((row, index) => {
			const numericId = row.rank && Number.isFinite(row.rank) ? row.rank : index + 1;
			const documentId = row.id ?? row.path ?? String(numericId);
			this.idToDocument.set(numericId, documentId);
			const location = row.path ? `${row.path}${row.lineStart ? `:${row.lineStart}` : ""}` : undefined;
			return {
				id: numericId,
				score: row.score,
				kind: "zbrain",
				preview: [location, row.snippet ?? row.title].filter(Boolean).join(" — "),
			};
		});
	}

	async timeline(_sessionId: string, _opts?: { around?: number; limit?: number }): Promise<MemoryHit[]> {
		return [];
	}

	async getObservations(ids: number[], _opts?: { expand?: boolean }): Promise<MemoryObservation[]> {
		const observations: MemoryObservation[] = [];
		for (const id of ids) {
			const documentId = this.idToDocument.get(id);
			if (!documentId) continue;
			const result = await this.exec(["get", documentId, "--json"]);
			if (result.exitCode !== 0) continue;
			const parsed = JSON.parse(result.stdout) as {
				document?: { content?: string; title?: string; provenance?: { path?: string } };
			};
			const content = parsed.document?.content;
			if (!content) continue;
			observations.push({
				id,
				kind: "zbrain",
				content,
				metadata: { title: parsed.document?.title, path: parsed.document?.provenance?.path },
			});
		}
		return observations;
	}

	async listSessions(_opts?: { limit?: number }): Promise<MemorySessionInfo[]> {
		return [];
	}

	async save(
		content: string,
		kind: ObservationKind = "fact",
		metadata?: Record<string, unknown>,
	): Promise<number | undefined> {
		const text = content.trim();
		if (!text) return undefined;
		await this.ensureWorkspace();
		const createdAt = this.now().toISOString();
		const slug = safeSlug(text.split(/\n+/)[0] ?? text);
		const dir = join(this.workspace, this.defaultCollection);
		mkdirSync(dir, { recursive: true });
		const filename = `${createdAt.replace(/[:.]/g, "-")}-${slug}.md`;
		const path = join(dir, filename);
		const body = [
			"---",
			`kind: ${yamlString(String(kind))}`,
			`created_at: ${yamlString(createdAt)}`,
			`source: ${yamlString("mewrite")}`,
			metadata?.session_id ? `session_id: ${yamlString(String(metadata.session_id))}` : undefined,
			"---",
			"",
			text,
			"",
		]
			.filter((line): line is string => line !== undefined)
			.join("\n");
		writeFileSync(path, body, "utf8");
		const result = await this.exec(["import", ".", "--json"]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || "zbrain import failed");
		}
		return undefined;
	}

	async forget(_ids: number[]): Promise<number> {
		return 0;
	}

	async export(_toPath: string): Promise<{ ok: boolean; bytes?: number; message?: string }> {
		return { ok: false, message: "zbrain export is not supported by this adapter" };
	}

	getWorkspace(): string {
		return this.workspace;
	}

	getDefaultCollection(): string {
		return this.defaultCollection;
	}

	private async ensureWorkspace(): Promise<void> {
		mkdirSync(this.workspace, { recursive: true });
		if (this.existsImpl(join(this.workspace, ".zbrain", "config.json"))) return;
		const result = await this.exec(["init", "--path", ".", "--json"]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || "zbrain init failed");
		}
	}

	private exec(args: string[]): Promise<ZbrainExecResult> {
		return new Promise((resolvePromise) => {
			let child: ReturnType<typeof spawn>;
			try {
				child = this.spawnImpl(this.command, args, {
					cwd: this.workspace,
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				resolvePromise({
					exitCode: 127,
					stdout: "",
					stderr: error instanceof Error ? error.message : String(error),
				});
				return;
			}
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			child.on("error", (error) => {
				resolvePromise({ exitCode: 127, stdout, stderr: stderr || error.message });
			});
			child.on("close", (code) => {
				resolvePromise({ exitCode: code ?? 0, stdout, stderr });
			});
		});
	}
}
