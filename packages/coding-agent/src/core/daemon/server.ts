/**
 * WS9 Daemon — HTTP + WebSocket server.
 *
 * - HTTP/REST endpoints implement openapi.yaml.
 * - WS endpoint per session implements JSON-RPC 2.0 for low-latency token
 *   streaming. Tokens are coalesced into ~16ms ticks before write to keep
 *   throughput high without burning context-switch budget.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
	DEFAULT_DAEMON_HOST,
	DEFAULT_DAEMON_PORT,
	type DoneParams,
	type Health,
	type MessageRecord,
	type RegisterWorkerRequest,
	type Role,
	type RpcEnvelope,
	type RpcNotification,
	type RpcRequest,
	type RpcResponse,
	type SendMessageRequest,
	type SessionRecord,
	type StateParams,
	TOKEN_TICK_MS,
	type TokenParams,
	type ToolParams,
	type Transcript,
	type WorkerRecord,
} from "./protocol.js";
import type { SessionStore } from "./store.js";

/**
 * The agent runner is injected so tests can stub it. Production wiring
 * defers to `createAgentSession()` from the SDK on the first user message.
 *
 * Each session gets one runner. The daemon calls `runner.send(text)` and the
 * runner pushes `token`, `tool`, `state`, `done` events on the bus.
 */
export interface AgentRunner {
	send(text: string): Promise<MessageRecord>;
	interrupt(): void;
	close(): void;
}

export type RunnerEvent =
	| { type: "token"; sessionId: string; text: string; role: Role }
	| { type: "tool"; sessionId: string; name: string; status: "start" | "ok" | "err" }
	| { type: "state"; sessionId: string; state: SessionRecord["state"] }
	| { type: "message"; message: MessageRecord }
	| { type: "done"; sessionId: string };

export type RunnerEmitter = (event: RunnerEvent) => void;

export type RunnerFactory = (session: SessionRecord, emit: RunnerEmitter) => AgentRunner;

export interface DaemonOptions {
	host?: string;
	port?: number;
	token?: string;
	store: SessionStore;
	runnerFactory: RunnerFactory;
	version?: string;
}

export interface DaemonHandle {
	host: string;
	port: number;
	server: Server;
	close(): Promise<void>;
}

interface AttachedClient {
	ws: WebSocket;
	sessionId: string;
	pendingTokens: TokenParams[];
	tickHandle?: NodeJS.Timeout;
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
	const host = opts.host ?? DEFAULT_DAEMON_HOST;
	const port = opts.port ?? DEFAULT_DAEMON_PORT;
	const startedAt = Date.now();
	const version = opts.version ?? "0.0.0";

	const runners = new Map<string, AgentRunner>();
	const clients = new Map<string, Set<AttachedClient>>();

	function emitForSession(sessionId: string): RunnerEmitter {
		return (event) => {
			if (event.type === "message") {
				opts.store.appendMessage(event.message);
				return;
			}
			const set = clients.get(sessionId);
			if (!set || set.size === 0) return;
			for (const c of set) {
				if (event.type === "token") {
					c.pendingTokens.push({ sessionId, text: event.text, role: event.role });
					if (!c.tickHandle) {
						c.tickHandle = setTimeout(() => flushTokens(c), TOKEN_TICK_MS);
					}
				} else if (event.type === "tool") {
					send(c.ws, notification("tool", { sessionId, name: event.name, status: event.status } as ToolParams));
				} else if (event.type === "state") {
					send(c.ws, notification("state", { sessionId, state: event.state } as StateParams));
				} else if (event.type === "done") {
					flushTokens(c);
					send(c.ws, notification("done", { sessionId } as DoneParams));
				}
			}
		};
	}

	function flushTokens(c: AttachedClient): void {
		if (c.tickHandle) {
			clearTimeout(c.tickHandle);
			c.tickHandle = undefined;
		}
		if (c.pendingTokens.length === 0) return;
		// Coalesce same-role consecutive tokens into a single notification to
		// minimize WS frame overhead. Order is preserved.
		const out: TokenParams[] = [];
		for (const tk of c.pendingTokens) {
			const last = out[out.length - 1];
			if (last && last.role === tk.role && last.sessionId === tk.sessionId) {
				last.text += tk.text;
			} else {
				out.push({ ...tk });
			}
		}
		c.pendingTokens.length = 0;
		for (const tk of out) {
			send(c.ws, notification("token", tk));
		}
	}

	function ensureRunner(session: SessionRecord): AgentRunner {
		let runner = runners.get(session.id);
		if (!runner) {
			runner = opts.runnerFactory(session, emitForSession(session.id));
			runners.set(session.id, runner);
		}
		return runner;
	}

	function authorize(req: IncomingMessage): boolean {
		if (!opts.token) return true;
		const auth = req.headers.authorization;
		if (!auth || Array.isArray(auth)) return false;
		const m = /^Bearer\s+(.+)$/.exec(auth);
		return !!m && m[1] === opts.token;
	}

	const httpServer = createServer(async (req, res) => {
		try {
			await handleHttp(req, res);
		} catch (err) {
			console.error("[mewrite serve] handler error:", err);
			if (!res.writableEnded) {
				res.statusCode = 500;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal error" }));
			}
		}
	});

	async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

		if (url.pathname === "/v1/health" && req.method === "GET") {
			const health: Health = { ok: true, version, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) };
			return json(res, 200, health);
		}

		if (!authorize(req)) {
			return json(res, 401, { error: "unauthorized" });
		}

		// /v1/sessions
		if (url.pathname === "/v1/sessions") {
			if (req.method === "GET") {
				const state = url.searchParams.get("state") ?? undefined;
				const limitStr = url.searchParams.get("limit");
				const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
				const sessions = opts.store.listSessions({
					state: state as SessionRecord["state"] | undefined,
					limit,
				});
				return json(res, 200, { sessions });
			}
			if (req.method === "POST") {
				const body = await readJson<{ cwd?: string; title?: string; model?: string; worker?: string }>(req);
				const session = opts.store.createSession({
					id: randomUUID(),
					cwd: body?.cwd ?? process.cwd(),
					title: body?.title,
					model: body?.model,
					worker: body?.worker,
				});
				return json(res, 201, session);
			}
		}

		// /v1/sessions/{id}*
		const sessionMatch = /^\/v1\/sessions\/([^/]+)(\/[^?]*)?$/.exec(url.pathname);
		if (sessionMatch) {
			const id = sessionMatch[1];
			const sub = sessionMatch[2] ?? "";
			const session = opts.store.getSession(id);
			if (!session) return json(res, 404, { error: "session not found" });

			if (sub === "" && req.method === "GET") return json(res, 200, session);
			if (sub === "" && req.method === "DELETE") {
				const runner = runners.get(id);
				if (runner) {
					runner.close();
					runners.delete(id);
				}
				opts.store.deleteSession(id);
				res.statusCode = 204;
				res.end();
				return;
			}

			if (sub === "/messages" && req.method === "POST") {
				const body = await readJson<SendMessageRequest>(req);
				if (!body || typeof body.text !== "string") {
					return json(res, 400, { error: "missing text" });
				}
				const runner = ensureRunner(session);
				const msg = await runner.send(body.text);
				return json(res, 202, msg);
			}

			if (sub === "/transcript" && req.method === "GET") {
				const messages = opts.store.getTranscript(id);
				const t: Transcript = { sessionId: id, messages };
				return json(res, 200, t);
			}
		}

		// /v1/workers
		if (url.pathname === "/v1/workers") {
			if (req.method === "GET") {
				return json(res, 200, { workers: opts.store.listWorkers() });
			}
			if (req.method === "POST") {
				const body = await readJson<RegisterWorkerRequest>(req);
				if (!body || !body.name || !body.url) return json(res, 400, { error: "missing name/url" });
				const w: WorkerRecord = {
					name: body.name,
					url: body.url,
					token: body.token,
					labels: body.labels,
					registeredAt: new Date().toISOString(),
				};
				return json(res, 201, opts.store.registerWorker(w));
			}
		}
		const workerMatch = /^\/v1\/workers\/([^/]+)$/.exec(url.pathname);
		if (workerMatch && req.method === "DELETE") {
			opts.store.removeWorker(workerMatch[1]);
			res.statusCode = 204;
			res.end();
			return;
		}

		json(res, 404, { error: "not found" });
	}

	const wss = new WebSocketServer({ noServer: true });

	httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const m = /^\/v1\/sessions\/([^/]+)\/stream$/.exec(url.pathname);
		if (!m) {
			socket.destroy();
			return;
		}
		if (!authorize(req)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		const sessionId = m[1];
		const session = opts.store.getSession(sessionId);
		if (!session) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			attachClient(sessionId, session, ws);
		});
	});

	function attachClient(sessionId: string, session: SessionRecord, ws: WebSocket): void {
		const client: AttachedClient = { ws, sessionId, pendingTokens: [] };
		let set = clients.get(sessionId);
		if (!set) {
			set = new Set();
			clients.set(sessionId, set);
		}
		set.add(client);

		// Send initial state snapshot.
		send(ws, notification("state", { sessionId, state: session.state } as StateParams));

		ws.on("message", async (raw) => {
			let env: RpcEnvelope | undefined;
			try {
				env = JSON.parse(raw.toString()) as RpcEnvelope;
			} catch {
				send(ws, errorResponse(0, -32700, "parse error"));
				return;
			}
			if (!env || env.jsonrpc !== "2.0" || !("method" in env)) {
				send(ws, errorResponse((env as RpcRequest)?.id ?? 0, -32600, "invalid request"));
				return;
			}
			const req = env as RpcRequest;
			try {
				if (req.method === "send") {
					const params = (req.params as { text?: string }) ?? {};
					if (typeof params.text !== "string") {
						send(ws, errorResponse(req.id, -32602, "missing text"));
						return;
					}
					const runner = ensureRunner(session);
					const msg = await runner.send(params.text);
					send(ws, okResponse(req.id, { id: msg.id }));
				} else if (req.method === "interrupt") {
					const runner = runners.get(sessionId);
					runner?.interrupt();
					send(ws, okResponse(req.id, { ok: true }));
				} else if (req.method === "ping") {
					send(ws, okResponse(req.id, { pong: true }));
				} else {
					send(ws, errorResponse(req.id, -32601, `method not found: ${req.method}`));
				}
			} catch (err) {
				send(ws, errorResponse(req.id, -32000, err instanceof Error ? err.message : "internal"));
			}
		});

		ws.on("close", () => {
			set?.delete(client);
			if (client.tickHandle) clearTimeout(client.tickHandle);
		});

		ws.on("error", () => {
			set?.delete(client);
			if (client.tickHandle) clearTimeout(client.tickHandle);
		});
	}

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(port, host, () => {
			httpServer.off("error", reject);
			resolve();
		});
	});

	return {
		host,
		port: (httpServer.address() as { port: number } | null)?.port ?? port,
		server: httpServer,
		async close() {
			for (const r of runners.values()) {
				try {
					r.close();
				} catch {
					// best-effort
				}
			}
			runners.clear();
			for (const set of clients.values()) {
				for (const c of set) {
					try {
						c.ws.close();
					} catch {
						// best-effort
					}
				}
			}
			clients.clear();
			await new Promise<void>((resolve) => {
				wss.close(() => resolve());
			});
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		},
	};
}

// ---- helpers -----------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	if (chunks.length === 0) return undefined;
	const text = Buffer.concat(chunks).toString("utf8");
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

function send(ws: WebSocket, env: RpcEnvelope): void {
	if (ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(env));
}

function notification<P>(method: string, params: P): RpcNotification<P> {
	return { jsonrpc: "2.0", method, params };
}

function okResponse<R>(id: RpcRequest["id"], result: R): RpcResponse<R> {
	return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: RpcRequest["id"], code: number, message: string): RpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}
