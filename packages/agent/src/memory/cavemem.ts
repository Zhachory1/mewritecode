/**
 * CavememProvider — wraps the cavemem CLI + stdio MCP server (WS7).
 *
 * Two communication channels:
 *   - WRITE: `cavemem hook run <event> --ide cave` (subprocess, JSON via stdin).
 *     Used for the 5 lifecycle hook stubs. Cavemem owns the redaction +
 *     compression pipeline; cave never re-implements it.
 *   - READ: cavemem stdio MCP server (`cavemem mcp`). Registered on the WS2
 *     `McpHub` with name `cavemem`. The 4 cavemem MCP tools then surface as
 *     `mcp__cavemem__search`, `mcp__cavemem__timeline`, etc. without us
 *     re-implementing JSON-RPC plumbing.
 *
 * The provider also speaks directly to the MCP hub's `callNamespaced()` for
 * synchronous reads (the `/memory search` slash command, the consolidation
 * pass) so we can reuse the warm transport even when the model isn't in the
 * loop.
 *
 * Source check: upstream does not ship a memory provider abstraction. Existing
 *   memory packages use different designs, such as qmd-powered semantic search
 *   over per-day logs/scratchpad. They could slot in behind this same interface as
 *   another provider if a user asked for it.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	type MemoryHit,
	type MemoryHookEvent,
	type MemoryHookPayload,
	type MemoryObservation,
	type MemoryProvider,
	type MemorySessionInfo,
	MemoryUnavailableError,
	type ObservationKind,
} from "./provider.js";

/**
 * MCP hub surface we need. Decoupled from the concrete McpHub class so this
 * file doesn't pull in the rest of the agent module on a circular import; tests
 * pass in a mock with the same shape.
 */
export interface CavememHubLike {
	listServers(): string[];
	addServer(config: {
		name: string;
		transport?: string;
		command?: string;
		args?: string[];
		env?: Record<string, string>;
		cwd?: string;
	}): void;
	connect(name: string): Promise<void>;
	callNamespaced(namespacedName: string, args: unknown): Promise<unknown>;
}

export interface CavememProviderOptions {
	/** Path to the cavemem CLI. Default: "cavemem" (resolved on $PATH). */
	binary?: string;
	/** Optional explicit data dir override (passed via env). */
	dataDir?: string;
	/**
	 * Optional already-constructed McpHub. If supplied, we register cavemem
	 * as a stdio MCP server on it so the LLM can call the four read tools
	 * directly. If omitted, only the hook + CLI surface works.
	 */
	hub?: CavememHubLike;
	/** Override the IDE label sent to cavemem. Default: "cave". */
	ide?: string;
	/** Subprocess spawn implementation, for tests. */
	spawnImpl?: typeof spawn;
	/** Override `existsSync` for tests. */
	existsImpl?: (p: string) => boolean;
	/** Skip the on-PATH check during construction (tests). */
	skipBinaryCheck?: boolean;
}

export interface CavememExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const SERVER_NAME = "cavemem";
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

export class CavememProvider implements MemoryProvider {
	readonly id = "cavemem";
	readonly label = "cavemem";

	private readonly binary: string;
	private readonly env: Record<string, string>;
	private readonly hub?: CavememHubLike;
	private readonly ide: string;
	private readonly spawnImpl: typeof spawn;
	private readonly existsImpl: (p: string) => boolean;
	private hubRegistered = false;

	constructor(options: CavememProviderOptions = {}) {
		this.binary = options.binary ?? "cavemem";
		this.env = options.dataDir ? { CAVEMEM_DATA_DIR: options.dataDir } : {};
		this.hub = options.hub;
		this.ide = options.ide ?? "cave";
		this.spawnImpl = options.spawnImpl ?? spawn;
		this.existsImpl = options.existsImpl ?? existsSync;
	}

	async isAvailable(): Promise<boolean> {
		// `cavemem --version` is the cheapest health probe; we don't actually
		// need the version output, just exit 0.
		const r = await this.exec(["--version"], { stdin: "" }).catch((e) => ({
			exitCode: 1,
			stdout: "",
			stderr: e instanceof Error ? e.message : String(e),
			timedOut: false,
		}));
		return r.exitCode === 0;
	}

	/** Register cavemem as a stdio MCP server on the given hub (idempotent). */
	registerOnHub(hub: CavememHubLike): void {
		if (this.hubRegistered) return;
		if (hub.listServers().includes(SERVER_NAME)) {
			this.hubRegistered = true;
			return;
		}
		hub.addServer({
			name: SERVER_NAME,
			transport: "stdio",
			command: this.binary,
			args: ["mcp"],
			env: this.env,
		});
		this.hubRegistered = true;
	}

	async dispatchHook(event: MemoryHookEvent, payload: MemoryHookPayload): Promise<void> {
		const stdin = `${JSON.stringify({ ...payload })}\n`;
		// Fire-and-forget for high-frequency events; await for session-start
		// so the prelude search can use anything the hook wrote.
		const synchronous = event === "session-start" || event === "session-end" || event === "stop";
		const args = ["hook", "run", event, "--ide", this.ide];
		const proc = this.exec(args, { stdin, timeoutMs: synchronous ? 5_000 : 2_000 });
		if (synchronous) {
			await proc.catch(() => {
				/* swallow — best effort */
			});
		} else {
			// Detach: never block the agent loop on PostToolUse writes.
			proc.catch(() => {
				/* swallow */
			});
		}
	}

	async search(query: string, opts?: { limit?: number }): Promise<MemoryHit[]> {
		const result = await this.callMcp<unknown>("search", { query, limit: opts?.limit });
		return parseHits(result);
	}

	async timeline(sessionId: string, opts?: { around?: number; limit?: number }): Promise<MemoryHit[]> {
		const result = await this.callMcp<unknown>("timeline", {
			session_id: sessionId,
			around_id: opts?.around,
			limit: opts?.limit,
		});
		return parseHits(result);
	}

	async getObservations(ids: number[], opts?: { expand?: boolean }): Promise<MemoryObservation[]> {
		if (ids.length === 0) return [];
		const result = await this.callMcp<unknown>("get_observations", {
			ids,
			expand: opts?.expand ?? true,
		});
		return parseObservations(result);
	}

	async listSessions(opts?: { limit?: number }): Promise<MemorySessionInfo[]> {
		const result = await this.callMcp<unknown>("list_sessions", { limit: opts?.limit });
		return parseSessions(result);
	}

	async save(
		content: string,
		kind: ObservationKind = "episodic",
		metadata?: Record<string, unknown>,
	): Promise<number | undefined> {
		// Cavemem doesn't currently expose a public "save" MCP tool — it's
		// hook-driven. To honour `/memory save`, we synthesise a UserPromptSubmit-
		// style hook payload tagged with the requested kind so the upstream
		// pipeline still does the redaction + compression.
		const payload: MemoryHookPayload = {
			session_id: (metadata?.session_id as string) ?? "cave-save",
			content,
			kind,
			metadata,
			ide: this.ide,
		};
		await this.dispatchHook("user-prompt-submit", payload);
		return undefined; // Cavemem assigns the id internally; we don't surface it.
	}

	async forget(ids: number[]): Promise<number> {
		// Cavemem CLI doesn't expose a delete subcommand directly; the closest
		// it offers is per-id redaction via a hook. Emit a synthetic hook so
		// the redaction lifecycle still applies. Returns the count we *asked*
		// to forget — true count is opaque on the cave side.
		if (ids.length === 0) return 0;
		await this.dispatchHook("post-tool-use", {
			session_id: "cave-forget",
			tool_name: "memory.forget",
			tool_input: { ids },
			ide: this.ide,
		});
		return ids.length;
	}

	async export(toPath: string): Promise<{ ok: boolean; bytes?: number; message?: string }> {
		const r = await this.exec(["export", toPath], { stdin: "" }).catch((e) => ({
			exitCode: 1,
			stdout: "",
			stderr: e instanceof Error ? e.message : String(e),
			timedOut: false,
		}));
		if (r.exitCode !== 0) {
			return { ok: false, message: r.stderr.trim() || `exit ${r.exitCode}` };
		}
		return { ok: true, message: r.stdout.trim() || undefined };
	}

	// -- internals -----------------------------------------------------------

	/**
	 * Call a cavemem MCP tool through the shared hub. Throws
	 * MemoryUnavailableError if no hub is wired (preserving the contract that
	 * cave callers gracefully degrade).
	 */
	private async callMcp<T>(tool: string, args: unknown): Promise<T> {
		if (!this.hub) {
			throw new MemoryUnavailableError(
				`CavememProvider: no MCP hub registered. Pass {hub} or register the provider on the WS2 hub.`,
			);
		}
		if (!this.hubRegistered) this.registerOnHub(this.hub);
		try {
			await this.hub.connect(SERVER_NAME);
		} catch (err) {
			throw new MemoryUnavailableError(
				`CavememProvider: cavemem MCP server connect failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		const out = await this.hub.callNamespaced(`${TOOL_PREFIX}${tool}`, args);
		return out as T;
	}

	/** Spawn cavemem with the given argv + stdin payload. */
	private exec(args: string[], opts: { stdin?: string; timeoutMs?: number }): Promise<CavememExecResult> {
		const stdin = opts.stdin ?? "";
		const timeoutMs = opts.timeoutMs ?? 5_000;
		return new Promise<CavememExecResult>((resolve) => {
			let child: ReturnType<typeof spawn>;
			try {
				child = this.spawnImpl(this.binary, args, {
					env: { ...process.env, ...this.env },
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (err) {
				resolve({
					exitCode: 127,
					stdout: "",
					stderr: err instanceof Error ? err.message : String(err),
					timedOut: false,
				});
				return;
			}

			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				try {
					child.kill("SIGTERM");
				} catch {
					/* ignore */
				}
			}, timeoutMs);

			child.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d) => {
				stderr += d.toString();
			});
			child.on("error", (err) => {
				clearTimeout(timer);
				resolve({ exitCode: 127, stdout, stderr: stderr || err.message, timedOut });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ exitCode: code ?? 0, stdout, stderr, timedOut });
			});

			if (child.stdin) {
				try {
					child.stdin.write(stdin);
					child.stdin.end();
				} catch {
					/* ignore */
				}
			}
		});
	}

	/** Convenience for tests + diagnostics. */
	get serverName(): string {
		return SERVER_NAME;
	}
}

// -- response parsing --------------------------------------------------------

/**
 * Cavemem MCP tools return MCP `CallToolResult` shapes:
 *   { content: [ { type: "text", text: <JSON-stringified payload> } ] }
 *
 * Some test transports may already return the parsed payload; tolerate both.
 */
function unwrapMcpJson(raw: unknown): unknown {
	if (raw == null || typeof raw !== "object") return raw;
	const obj = raw as Record<string, unknown>;
	if (Array.isArray(obj.content)) {
		const first = obj.content.find(
			(c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
		) as { text?: unknown } | undefined;
		if (first?.text && typeof first.text === "string") {
			try {
				return JSON.parse(first.text);
			} catch {
				return first.text;
			}
		}
	}
	return raw;
}

function parseHits(raw: unknown): MemoryHit[] {
	const payload = unwrapMcpJson(raw);
	if (!Array.isArray(payload)) return [];
	const out: MemoryHit[] = [];
	for (const e of payload) {
		if (!e || typeof e !== "object") continue;
		const r = e as Record<string, unknown>;
		const id = typeof r.id === "number" ? r.id : Number(r.id);
		if (!Number.isFinite(id)) continue;
		out.push({
			id,
			score: typeof r.score === "number" ? r.score : undefined,
			kind: typeof r.kind === "string" ? (r.kind as ObservationKind) : undefined,
			ts: typeof r.ts === "string" ? r.ts : undefined,
			preview: typeof r.preview === "string" ? r.preview : typeof r.content === "string" ? r.content : undefined,
			session_id: typeof r.session_id === "string" ? r.session_id : undefined,
		});
	}
	return out;
}

function parseObservations(raw: unknown): MemoryObservation[] {
	const payload = unwrapMcpJson(raw);
	if (!Array.isArray(payload)) return [];
	const out: MemoryObservation[] = [];
	for (const e of payload) {
		if (!e || typeof e !== "object") continue;
		const r = e as Record<string, unknown>;
		const id = typeof r.id === "number" ? r.id : Number(r.id);
		if (!Number.isFinite(id)) continue;
		out.push({
			id,
			session_id: typeof r.session_id === "string" ? r.session_id : undefined,
			kind: typeof r.kind === "string" ? (r.kind as ObservationKind) : undefined,
			ts: typeof r.ts === "string" ? r.ts : undefined,
			content: typeof r.content === "string" ? r.content : "",
			metadata:
				typeof r.metadata === "object" && r.metadata !== null ? (r.metadata as Record<string, unknown>) : undefined,
		});
	}
	return out;
}

function parseSessions(raw: unknown): MemorySessionInfo[] {
	const payload = unwrapMcpJson(raw);
	if (!Array.isArray(payload)) return [];
	const out: MemorySessionInfo[] = [];
	for (const e of payload) {
		if (!e || typeof e !== "object") continue;
		const r = e as Record<string, unknown>;
		const id = typeof r.id === "string" ? r.id : undefined;
		if (!id) continue;
		out.push({
			id,
			ide: typeof r.ide === "string" ? r.ide : undefined,
			cwd: typeof r.cwd === "string" ? r.cwd : undefined,
			started_at: typeof r.started_at === "string" ? r.started_at : undefined,
			ended_at: typeof r.ended_at === "string" ? r.ended_at : null,
		});
	}
	return out;
}

/**
 * Compose a single-line "context prelude" from a list of hits — used by the
 * session-start prelude. Stays under ~600 chars to fit comfortably in the
 * cache-stable layout.
 */
export function formatPrelude(hits: MemoryHit[], opts: { max?: number } = {}): string {
	const max = Math.max(1, Math.min(10, opts.max ?? 5));
	if (hits.length === 0) return "";
	const lines = ["[memory] recent observations:"];
	for (const h of hits.slice(0, max)) {
		const tag = h.kind ? `[${h.kind}]` : "[obs]";
		const preview = (h.preview ?? "").replace(/\s+/g, " ").trim();
		lines.push(`  ${tag} #${h.id} ${preview.slice(0, 120)}`);
	}
	return lines.join("\n");
}
