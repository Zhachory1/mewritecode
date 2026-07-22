/**
 * WS9 Daemon — HTTP + WebSocket server.
 *
 * - HTTP/REST endpoints implement openapi.yaml.
 * - WS endpoint per session implements JSON-RPC 2.0 for low-latency token
 *   streaming. Tokens are coalesced into ~16ms ticks before write to keep
 *   throughput high without burning context-switch budget.
 */

import { randomUUID } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { getAgentDir, getWebUiDir } from "../../config.js";
import { loadSkills } from "../skills.js";
import { onFileMutation } from "../tools/file-mutation-queue.js";
import {
	type ApprovalDecision,
	type ApprovalDecisionParams,
	type ApprovalParams,
	DEFAULT_DAEMON_HOST,
	DEFAULT_DAEMON_PORT,
	type DoneParams,
	type FileChangedParams,
	type FileTreeEntry,
	type FileTreeResponse,
	type Health,
	type HealthCapabilities,
	type MessageRecord,
	type ReadFileResponse,
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
	type WriteFileRequest,
	type WriteFileResponse,
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
	respondApproval?(approvalId: string, decision: ApprovalDecision): void;
	cancelApprovals?(): void;
}

export type RunnerEvent =
	| { type: "token"; sessionId: string; text: string; role: Role }
	| { type: "tool"; sessionId: string; name: string; status: "start" | "ok" | "err" }
	| { type: "state"; sessionId: string; state: SessionRecord["state"] }
	| { type: "approval"; sessionId: string; approvalId: string; toolName: string; args: unknown; tier: string }
	| { type: "message"; message: MessageRecord }
	| { type: "done"; sessionId: string };

export type RunnerEmitter = (event: RunnerEvent) => boolean;

export type RunnerFactory = (session: SessionRecord, emit: RunnerEmitter) => AgentRunner;

export interface DaemonOptions {
	host?: string;
	port?: number;
	token?: string;
	store: SessionStore;
	runnerFactory: RunnerFactory;
	version?: string;
	capabilities?: Partial<HealthCapabilities>;
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
	approvalCapable: boolean;
	tickHandle?: NodeJS.Timeout;
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
	const host = opts.host ?? DEFAULT_DAEMON_HOST;
	const port = opts.port ?? DEFAULT_DAEMON_PORT;
	if (!opts.token && !isLoopbackName(host)) {
		throw new Error("token is required when host is not loopback");
	}
	const startedAt = Date.now();
	const version = opts.version ?? "0.0.0";
	const capabilities: HealthCapabilities = {
		runnerKind: opts.capabilities?.runnerKind ?? "echo",
		approvalSupported: opts.capabilities?.approvalSupported ?? false,
	};
	const webUiDir = getWebUiDir();

	const runners = new Map<string, AgentRunner>();
	const clients = new Map<string, Set<AttachedClient>>();

	function emitForSession(sessionId: string): RunnerEmitter {
		return (event) => {
			if (event.type === "message") {
				opts.store.appendMessage(event.message);
				return true;
			}
			if (event.type === "state") {
				opts.store.updateSession(event.sessionId, { state: event.state });
			}
			const set = clients.get(sessionId);
			if (!set || set.size === 0) return false;
			let delivered = false;
			for (const c of set) {
				if (event.type === "approval" && !c.approvalCapable) continue;
				delivered = true;
				if (event.type === "token") {
					c.pendingTokens.push({ sessionId, text: event.text, role: event.role });
					if (!c.tickHandle) {
						c.tickHandle = setTimeout(() => flushTokens(c), TOKEN_TICK_MS);
					}
				} else if (event.type === "tool") {
					send(c.ws, notification("tool", { sessionId, name: event.name, status: event.status } as ToolParams));
				} else if (event.type === "state") {
					send(c.ws, notification("state", { sessionId, state: event.state } as StateParams));
				} else if (event.type === "approval") {
					send(c.ws, notification("approval", event as ApprovalParams));
				} else if (event.type === "done") {
					flushTokens(c);
					send(c.ws, notification("done", { sessionId } as DoneParams));
				}
			}
			return delivered;
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
		return readBearerToken(req) === opts.token;
	}

	function authorizeWebSocket(req: IncomingMessage): boolean {
		if (!opts.token) return true;
		return readBearerToken(req) === opts.token || readWebSocketProtocolToken(req) === opts.token;
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
		if (!isAllowedHost(req.headers.host, opts.token)) {
			return json(res, 403, { error: "forbidden host" });
		}
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

		if (req.method === "GET" && isWebUiPath(url.pathname)) {
			return serveWebUi(res, webUiDir, url.pathname);
		}

		if (url.pathname.startsWith("/v1/") && !isAllowedOrigin(req, url, opts.token)) {
			return json(res, 403, { error: "forbidden origin" });
		}

		if (url.pathname === "/v1/health" && req.method === "GET") {
			const health: Health = {
				ok: true,
				version,
				uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
				capabilities,
			};
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

			if (sub === "/files/tree" && req.method === "GET") {
				return handleFileTree(res, session, url.searchParams.get("path") ?? "");
			}

			if (sub === "/files/read" && req.method === "GET") {
				return handleFileRead(res, session, url.searchParams.get("path") ?? "");
			}

			if (sub === "/files/write" && req.method === "PUT") {
				const body = await readJsonCapped<WriteFileRequest>(req, MAX_FILE_BYTES * 6 + 8192);
				if (body.tooLarge) return json(res, 413, { error: "request too large" });
				return handleFileWrite(res, session, body.value);
			}

			if (sub === "/skills" && req.method === "GET") {
				return handleListSkills(res, session);
			}
		}

		// /v1/fs/list — daemon-level directory browser for the session cwd picker.
		if (url.pathname === "/v1/fs/list" && req.method === "GET") {
			return handleFsList(res, url.searchParams.get("path"));
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

	const wss = new WebSocketServer({
		noServer: true,
		handleProtocols(protocols) {
			return protocols.has("mewrite-auth") ? "mewrite-auth" : false;
		},
	});

	httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
		if (!isAllowedHost(req.headers.host, opts.token)) {
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const m = /^\/v1\/sessions\/([^/]+)\/stream$/.exec(url.pathname);
		if (!m) {
			socket.destroy();
			return;
		}
		if (!isAllowedOrigin(req, url, opts.token)) {
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}
		if (!authorizeWebSocket(req)) {
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
		const client: AttachedClient = { ws, sessionId, pendingTokens: [], approvalCapable: false };
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
				} else if (req.method === "client_capabilities") {
					const params = (req.params as { approval?: unknown } | undefined) ?? undefined;
					client.approvalCapable = params?.approval === true;
					send(ws, okResponse(req.id, { ok: true }));
				} else if (req.method === "approval_decision") {
					const params = (req.params as ApprovalDecisionParams | undefined) ?? undefined;
					if (!params || typeof params.approvalId !== "string" || !isApprovalDecision(params.decision)) {
						send(ws, errorResponse(req.id, -32602, "missing approval decision"));
						return;
					}
					const runner = runners.get(sessionId);
					runner?.respondApproval?.(params.approvalId, params.decision);
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

		const detach = () => {
			set?.delete(client);
			if (client.tickHandle) clearTimeout(client.tickHandle);
			if (!set || ![...set].some((attached) => attached.approvalCapable)) {
				runners.get(sessionId)?.cancelApprovals?.();
			}
		};

		ws.on("close", detach);
		ws.on("error", detach);
	}

	// Fan file mutations out to any WS clients whose session cwd contains the
	// mutated path. Emits `file` notifications so browsers can refetch the
	// affected directory / open file without polling.
	//
	// The mutation queue emits realpath-normalized targets, so we must realpath
	// each session's cwd once for the compare (e.g. macOS /tmp -> /private/tmp).
	const sessionRootCache = new Map<string, string>();
	const resolveSessionRoot = (sessionId: string, cwd: string): string => {
		const cached = sessionRootCache.get(sessionId);
		if (cached !== undefined) return cached;
		let resolved = cwd;
		try {
			resolved = realpathSync(cwd);
		} catch {
			// Fall back to the raw cwd; missing/deleted session directories still
			// permit lexical prefix matching for anything still under them.
		}
		sessionRootCache.set(sessionId, resolved);
		return resolved;
	};
	const unsubscribeFileMutations = onFileMutation((event) => {
		for (const [sessionId, set] of clients.entries()) {
			if (set.size === 0) continue;
			const session = opts.store.getSession(sessionId);
			if (!session) continue;
			const root = resolveSessionRoot(sessionId, session.cwd);
			const relPath = relativeIfWithin(root, event.path);
			if (relPath === undefined) continue;
			const params: FileChangedParams = { sessionId, path: relPath, at: event.at };
			for (const c of set) send(c.ws, notification("file", params));
		}
	});

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
			unsubscribeFileMutations();
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

function isWebUiPath(pathname: string): boolean {
	return pathname === "/" || pathname.startsWith("/web/");
}

async function serveWebUi(res: ServerResponse, webUiDir: string, pathname: string): Promise<void> {
	const rel = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/web\//, ""));
	if (rel.startsWith("..") || rel.includes("/../")) return text(res, 400, "bad path");
	const file = join(webUiDir, rel);
	try {
		const s = await stat(file);
		if (!s.isFile()) return text(res, 404, "not found");
		res.statusCode = 200;
		res.setHeader("content-type", contentType(file));
		createReadStream(file).pipe(res);
	} catch {
		text(res, 404, "not found");
	}
}

function text(res: ServerResponse, status: number, body: string): void {
	res.statusCode = status;
	res.setHeader("content-type", "text/plain; charset=utf-8");
	res.end(body);
}

function contentType(file: string): string {
	if (file.endsWith(".html")) return "text/html; charset=utf-8";
	if (file.endsWith(".css")) return "text/css; charset=utf-8";
	if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (file.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}

function isAllowedHost(host: string | undefined, token: string | undefined): boolean {
	if (token) return true;
	if (!host) return false;
	try {
		return isLoopbackName(new URL(`http://${host}`).hostname);
	} catch {
		return false;
	}
}

function isAllowedOrigin(req: IncomingMessage, url: URL, token: string | undefined): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	if (Array.isArray(origin)) return false;
	try {
		const parsed = new URL(origin);
		return (
			parsed.protocol === url.protocol &&
			parsed.host === url.host &&
			(token !== undefined || isLoopbackName(parsed.hostname))
		);
	} catch {
		return false;
	}
}

function isLoopbackName(name: string): boolean {
	const host = name.toLowerCase();
	return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Return the POSIX-style relative path of `target` under `root`, or `undefined`
 * if `target` is not inside `root`. Uses realpath-independent lexical compare;
 * callers should feed already-normalized paths.
 */
function relativeIfWithin(root: string, target: string): string | undefined {
	if (!root) return undefined;
	const rel = relative(root, target);
	if (rel === "") return "";
	if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return rel.replaceAll("\\", "/");
}

function readBearerToken(req: IncomingMessage): string | undefined {
	const auth = req.headers.authorization;
	if (!auth || Array.isArray(auth)) return undefined;
	return /^Bearer\s+(.+)$/.exec(auth)?.[1];
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
	return value === "once" || value === "session" || value === "deny";
}

function readWebSocketProtocolToken(req: IncomingMessage): string | undefined {
	const raw = req.headers["sec-websocket-protocol"];
	if (!raw || Array.isArray(raw)) return undefined;
	for (const part of raw.split(",")) {
		const protocol = part.trim();
		if (!protocol.startsWith("mewrite-bearer.")) continue;
		try {
			return Buffer.from(protocol.slice("mewrite-bearer.".length), "base64url").toString("utf8");
		} catch {
			return undefined;
		}
	}
	return undefined;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TREE_ENTRIES = 1000;
const WRITE_LOCKS = new Map<string, Promise<void>>();
const DENIED_PATH_SEGMENTS = new Set([".git", ".ssh", ".aws", ".gcp", ".azure", ".kube", ".docker", ".gnupg"]);
const DENIED_FILE_NAMES = new Set([
	".npmrc",
	".pypirc",
	".envrc",
	".netrc",
	".gitconfig",
	"credentials",
	"config.json",
	"id_rsa",
	"id_ed25519",
	"id_ecdsa",
]);
const OMITTED_TREE_NAMES = new Set(["node_modules", "dist", "coverage", ".next"]);

async function handleFsList(res: ServerResponse, requested: string | null): Promise<void> {
	const target = requested && requested.length > 0 ? requested : homedir();
	if (!isAbsolute(target)) return json(res, 400, { error: "path must be absolute" });
	let realPath: string;
	try {
		realPath = await realpath(target);
	} catch {
		return json(res, 404, { error: "path not found" });
	}
	try {
		const s = await stat(realPath);
		if (!s.isDirectory()) return json(res, 400, { error: "path is not a directory" });
		const dirents = await readdir(realPath, { withFileTypes: true });
		const entries: FileTreeEntry[] = [];
		for (const dirent of dirents) {
			if (dirent.isSymbolicLink()) continue;
			if (!dirent.isDirectory()) continue;
			if (DENIED_PATH_SEGMENTS.has(dirent.name)) continue;
			if (dirent.name.startsWith(".env")) continue;
			entries.push({
				name: dirent.name,
				path: join(realPath, dirent.name),
				type: "directory",
			});
			if (entries.length > MAX_TREE_ENTRIES) return json(res, 413, { error: "directory too large" });
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		const parentPath = dirname(realPath);
		return json(res, 200, {
			path: realPath,
			parent: parentPath === realPath ? null : parentPath,
			home: homedir(),
			entries,
		});
	} catch (err) {
		return json(res, 403, { error: err instanceof Error ? err.message : "cannot list directory" });
	}
}

async function handleListSkills(res: ServerResponse, session: SessionRecord): Promise<void> {
	try {
		const result = loadSkills({ cwd: session.cwd, agentDir: getAgentDir() });
		const skills = result.skills.map((s) => ({
			name: s.name,
			description: s.description || "",
		}));
		return json(res, 200, { sessionId: session.id, skills });
	} catch (err) {
		return json(res, 500, { error: err instanceof Error ? err.message : "failed to load skills" });
	}
}

async function handleFileTree(res: ServerResponse, session: SessionRecord, requestPath: string): Promise<void> {
	const resolved = await resolveSessionPath(session, requestPath);
	if ("error" in resolved) return json(res, resolved.status, { error: resolved.error });
	if (isDeniedPath(resolved.requestPath) || isDeniedPath(resolved.realRequestPath)) {
		return json(res, 403, { error: "path denied" });
	}
	const s = await lstat(resolved.realPath);
	if (!s.isDirectory()) return json(res, 400, { error: "path is not a directory" });
	const dirents = await readdir(resolved.realPath, { withFileTypes: true });
	if (dirents.length > MAX_TREE_ENTRIES) return json(res, 413, { error: "directory too large" });
	const entries: FileTreeEntry[] = [];
	for (const dirent of dirents) {
		if (OMITTED_TREE_NAMES.has(dirent.name) || isDeniedPath(dirent.name) || dirent.isSymbolicLink()) continue;
		if (!dirent.isDirectory() && !dirent.isFile()) continue;
		const childPath = resolved.requestPath ? `${resolved.requestPath}/${dirent.name}` : dirent.name;
		const childStat = dirent.isFile() ? await stat(join(resolved.realPath, dirent.name)) : undefined;
		entries.push({
			name: dirent.name,
			path: childPath,
			type: dirent.isDirectory() ? "directory" : "file",
			size: childStat?.size,
		});
	}
	entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
	const body: FileTreeResponse = { sessionId: session.id, path: resolved.requestPath, entries };
	return json(res, 200, body);
}

async function handleFileRead(res: ServerResponse, session: SessionRecord, requestPath: string): Promise<void> {
	const resolved = await resolveSessionPath(session, requestPath);
	if ("error" in resolved) return json(res, resolved.status, { error: resolved.error });
	const s = await lstat(resolved.realPath);
	if (!s.isFile()) return json(res, 400, { error: "path is not a file" });
	if (isDeniedPath(resolved.requestPath) || isDeniedPath(resolved.realRequestPath)) {
		return json(res, 403, { error: "file denied" });
	}
	if (s.size > MAX_FILE_BYTES) return json(res, 413, { error: "file too large" });
	const buffer = await readFile(resolved.realPath);
	if (buffer.includes(0)) return json(res, 415, { error: "binary file unsupported" });
	let textContent: string;
	try {
		textContent = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return json(res, 415, { error: "utf8 file required" });
	}
	const body: ReadFileResponse = {
		sessionId: session.id,
		path: resolved.requestPath,
		text: textContent,
		size: s.size,
		mtimeMs: s.mtimeMs,
		encoding: "utf8",
	};
	return json(res, 200, body);
}

async function handleFileWrite(
	res: ServerResponse,
	session: SessionRecord,
	body: WriteFileRequest | undefined,
): Promise<void> {
	if (!body || typeof body.path !== "string" || typeof body.text !== "string") {
		return json(res, 400, { error: "missing path/text" });
	}
	const resolved = await resolveSessionPath(session, body.path);
	if ("error" in resolved) return json(res, resolved.status, { error: resolved.error });
	return withWriteLock(resolved.realPath, async () => {
		const s = await lstat(resolved.realPath);
		if (!s.isFile()) return json(res, 400, { error: "path is not a file" });
		if (isDeniedPath(resolved.requestPath) || isDeniedPath(resolved.realRequestPath)) {
			return json(res, 403, { error: "file denied" });
		}
		if (typeof body.expectedMtimeMs !== "number" || typeof body.expectedSize !== "number") {
			return json(res, 400, { error: "missing file precondition" });
		}
		if (body.expectedMtimeMs !== s.mtimeMs || body.expectedSize !== s.size) {
			return json(res, 409, { error: "file changed on disk" });
		}
		const buffer = Buffer.from(body.text, "utf8");
		if (buffer.includes(0)) return json(res, 415, { error: "binary file unsupported" });
		if (buffer.byteLength > MAX_FILE_BYTES) return json(res, 413, { error: "file too large" });
		await writeFile(resolved.realPath, buffer);
		const next = await stat(resolved.realPath);
		const response: WriteFileResponse = {
			sessionId: session.id,
			path: resolved.requestPath,
			size: next.size,
			mtimeMs: next.mtimeMs,
			encoding: "utf8",
		};
		return json(res, 200, response);
	});
}

async function withWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	const previous = WRITE_LOCKS.get(path) ?? Promise.resolve();
	let release!: () => void;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chain = previous.catch(() => {}).then(() => next);
	WRITE_LOCKS.set(path, chain);
	await previous.catch(() => {});
	try {
		return await fn();
	} finally {
		release();
		if (WRITE_LOCKS.get(path) === chain) WRITE_LOCKS.delete(path);
	}
}

function isDeniedPath(requestPath: string): boolean {
	const parts = requestPath.split("/").filter(Boolean);
	for (const part of parts) {
		if (DENIED_PATH_SEGMENTS.has(part) || DENIED_FILE_NAMES.has(part)) return true;
		if (part.startsWith(".env")) return true;
		if (part.endsWith(".pem") || part.endsWith(".key")) return true;
	}
	return false;
}

async function resolveSessionPath(
	session: SessionRecord,
	requestPath: string,
): Promise<
	| { rootReal: string; realPath: string; requestPath: string; realRequestPath: string }
	| { status: number; error: string }
> {
	const normalized = normalize(requestPath.trim()).replaceAll("\\", "/");
	const relPath = normalized === "." ? "" : normalized.startsWith("./") ? normalized.slice(2) : normalized;
	if (isAbsolute(requestPath) || isAbsolute(relPath) || relPath.startsWith("..") || relPath.includes("/../")) {
		return { status: 400, error: "invalid path" };
	}
	try {
		const rootReal = await realpath(session.cwd);
		const target = resolve(rootReal, relPath || ".");
		const realPath = await realpath(target);
		const rawRealRelPath = relative(rootReal, realPath);
		const realRelPath = rawRealRelPath.replaceAll("\\", "/");
		const withinRoot = realPath === rootReal || (!rawRealRelPath.startsWith("..") && !isAbsolute(rawRealRelPath));
		if (!withinRoot) return { status: 403, error: "path outside session root" };
		return { rootReal, realPath, requestPath: relPath === "." ? "" : relPath, realRequestPath: realRelPath };
	} catch {
		return { status: 404, error: "path not found" };
	}
}

async function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return parseJsonChunks<T>(chunks);
}

async function readJsonCapped<T>(req: IncomingMessage, maxBytes: number): Promise<{ value?: T; tooLarge?: boolean }> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const c of req) {
		const chunk = c as Buffer;
		total += chunk.byteLength;
		if (total > maxBytes) return { tooLarge: true };
		chunks.push(chunk);
	}
	return { value: parseJsonChunks<T>(chunks) };
}

function parseJsonChunks<T>(chunks: Buffer[]): T | undefined {
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
