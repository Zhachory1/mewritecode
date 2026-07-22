/**
 * WS9 Daemon — HTTP + WS client used by `mewrite attach`, `cave list`, the SDK,
 * and (mocked) by tests.
 *
 * Same wire format as `server.ts`. Hand-written so the SDK package can copy
 * the same code without an OpenAPI generator step (TODO(ws9-codegen)).
 */

import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import {
	type CreateSessionRequest,
	DEFAULT_DAEMON_HOST,
	DEFAULT_DAEMON_PORT,
	type Health,
	type MessageRecord,
	type RegisterWorkerRequest,
	type RpcEnvelope,
	type RpcRequest,
	type RpcResponse,
	type SendMessageRequest,
	type SessionRecord,
	type SessionState,
	type Transcript,
	type WorkerRecord,
} from "./protocol.js";

export interface ClientOptions {
	baseUrl?: string;
	host?: string;
	port?: number;
	token?: string;
}

export class CaveClient {
	private baseUrl: string;
	private wsUrl: string;
	private token?: string;

	constructor(opts: ClientOptions = {}) {
		const host = opts.host ?? DEFAULT_DAEMON_HOST;
		const port = opts.port ?? DEFAULT_DAEMON_PORT;
		this.baseUrl = (opts.baseUrl ?? `http://${host}:${port}`).replace(/\/+$/, "");
		this.wsUrl = this.baseUrl.replace(/^http/, "ws");
		this.token = opts.token;
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		const h: Record<string, string> = { "content-type": "application/json", ...extra };
		if (this.token) h.authorization = `Bearer ${this.token}`;
		return h;
	}

	async health(): Promise<Health> {
		return this.req<Health>("GET", "/v1/health");
	}

	async listSessions(filter?: { state?: SessionState; limit?: number }): Promise<SessionRecord[]> {
		const qs = new URLSearchParams();
		if (filter?.state) qs.set("state", filter.state);
		if (filter?.limit != null) qs.set("limit", String(filter.limit));
		const path = `/v1/sessions${qs.toString() ? `?${qs.toString()}` : ""}`;
		const res = await this.req<{ sessions: SessionRecord[] }>("GET", path);
		return res.sessions;
	}

	async createSession(input: CreateSessionRequest = {}): Promise<SessionRecord> {
		return this.req<SessionRecord>("POST", "/v1/sessions", input);
	}

	async getSession(id: string): Promise<SessionRecord> {
		return this.req<SessionRecord>("GET", `/v1/sessions/${encodeURIComponent(id)}`);
	}

	async deleteSession(id: string): Promise<void> {
		await this.req<void>("DELETE", `/v1/sessions/${encodeURIComponent(id)}`);
	}

	async send(id: string, body: SendMessageRequest): Promise<MessageRecord> {
		return this.req<MessageRecord>("POST", `/v1/sessions/${encodeURIComponent(id)}/messages`, body);
	}

	async getTranscript(id: string): Promise<Transcript> {
		return this.req<Transcript>("GET", `/v1/sessions/${encodeURIComponent(id)}/transcript`);
	}

	async listWorkers(): Promise<WorkerRecord[]> {
		const res = await this.req<{ workers: WorkerRecord[] }>("GET", "/v1/workers");
		return res.workers;
	}

	async registerWorker(req: RegisterWorkerRequest): Promise<WorkerRecord> {
		return this.req<WorkerRecord>("POST", "/v1/workers", req);
	}

	async removeWorker(name: string): Promise<void> {
		await this.req<void>("DELETE", `/v1/workers/${encodeURIComponent(name)}`);
	}

	attach(sessionId: string): AttachedSession {
		const url = `${this.wsUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
		const ws = new WebSocket(url, {
			headers: this.token ? { authorization: `Bearer ${this.token}` } : undefined,
		});
		return new AttachedSession(ws);
	}

	private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (res.status === 204) return undefined as T;
		const text = await res.text();
		if (!res.ok) {
			let detail: unknown = text;
			try {
				detail = JSON.parse(text);
			} catch {
				/* ignore */
			}
			const message =
				typeof detail === "object" && detail && "error" in detail
					? String((detail as { error: string }).error)
					: text || res.statusText;
			throw new Error(`${method} ${path} → ${res.status}: ${message}`);
		}
		if (!text) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			return text as unknown as T;
		}
	}
}

/** Strongly-typed event surface for an attached WS session. */
export interface AttachedSessionEvents {
	open: () => void;
	close: () => void;
	error: (err: Error) => void;
	token: (params: { sessionId: string; text: string; role: string }) => void;
	tool: (params: { sessionId: string; name: string; status: string }) => void;
	state: (params: { sessionId: string; state: string }) => void;
	done: (params: { sessionId: string }) => void;
	file: (params: { sessionId: string; path: string; at: number }) => void;
	approval: (params: { sessionId: string; approvalId: string; toolName: string; args: unknown; tier: string }) => void;
}

export interface AttachedSession {
	on<K extends keyof AttachedSessionEvents>(event: K, listener: AttachedSessionEvents[K]): this;
	once<K extends keyof AttachedSessionEvents>(event: K, listener: AttachedSessionEvents[K]): this;
	off<K extends keyof AttachedSessionEvents>(event: K, listener: AttachedSessionEvents[K]): this;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: class extends EventEmitter; interface adds strongly-typed on/once/off overloads.
export class AttachedSession extends EventEmitter {
	private nextId = 1;
	private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private opened: Promise<void>;

	constructor(private ws: WebSocket) {
		super();
		this.opened = new Promise<void>((resolve, reject) => {
			ws.once("open", () => {
				this.emit("open");
				resolve();
			});
			ws.once("error", (err) => {
				this.emit("error", err);
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
		ws.on("message", (raw) => this.onMessage(raw.toString()));
		ws.on("close", () => this.emit("close"));
	}

	private onMessage(raw: string): void {
		let env: RpcEnvelope;
		try {
			env = JSON.parse(raw) as RpcEnvelope;
		} catch {
			return;
		}
		if ("method" in env) {
			const params = env.params as Record<string, unknown> | undefined;
			this.emit(env.method, params);
			return;
		}
		const resp = env as RpcResponse;
		const handler = this.pending.get(resp.id);
		if (!handler) return;
		this.pending.delete(resp.id);
		if (resp.error) {
			handler.reject(new Error(resp.error.message));
		} else {
			handler.resolve(resp.result);
		}
	}

	async ready(): Promise<void> {
		await this.opened;
	}

	async send(text: string): Promise<{ id: string }> {
		await this.opened;
		return this.rpc<{ id: string }>("send", { text });
	}

	async interrupt(): Promise<{ ok: true }> {
		await this.opened;
		return this.rpc<{ ok: true }>("interrupt", {});
	}

	close(): void {
		try {
			this.ws.close();
		} catch {
			/* best-effort */
		}
	}

	private rpc<R>(method: string, params: unknown): Promise<R> {
		const id = this.nextId++;
		const req: RpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise<R>((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
			});
			this.ws.send(JSON.stringify(req));
		});
	}
}
