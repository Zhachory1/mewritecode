/**
 * WS9 — daemon end-to-end tests.
 *
 * Covers:
 *   - server boot + shutdown
 *   - OpenAPI handler routing (sessions create/get/list/delete, transcript)
 *   - SQLite session round-trip (persistence across daemon restart)
 *   - WS streaming roundtrip (token notifications coalesced)
 *   - worker registration via HTTP API
 *   - `caveman attach` end-to-end (mocked LLM via the default echo runner)
 *   - bearer token auth
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { SessionStore } from "../src/core/daemon/index.js";
import {
	CaveClient,
	createDefaultRunnerFactory,
	type DaemonHandle,
	openStore,
	startDaemon,
} from "../src/core/daemon/index.js";

interface Fixture {
	tmpDir: string;
	dbPath: string;
	store: SessionStore;
	handle: DaemonHandle;
	client: CaveClient;
}

async function bootDaemon(opts: { token?: string } = {}): Promise<Fixture> {
	const tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-test-"));
	const dbPath = join(tmpDir, "sessions.db");
	const store = openStore(dbPath);
	const handle = await startDaemon({
		host: "127.0.0.1",
		port: 0, // ephemeral
		token: opts.token,
		store,
		runnerFactory: createDefaultRunnerFactory({ tokensPerSecond: 2000 }),
		version: "test",
	});
	const client = new CaveClient({ host: handle.host, port: handle.port, token: opts.token });
	return { tmpDir, dbPath, store, handle, client };
}

async function shutdown(fixture: Fixture): Promise<void> {
	await fixture.handle.close();
	fixture.store.close();
	rmSync(fixture.tmpDir, { recursive: true, force: true });
}

describe("WS9 daemon — boot + health", () => {
	let f: Fixture;
	beforeEach(async () => {
		f = await bootDaemon();
	});
	afterEach(async () => {
		await shutdown(f);
	});

	it("responds to /v1/health without auth", async () => {
		const h = await f.client.health();
		expect(h.ok).toBe(true);
		expect(h.version).toBe("test");
		expect(h.uptimeSec).toBeGreaterThanOrEqual(0);
		expect(h.capabilities).toEqual({ runnerKind: "echo", approvalSupported: false });
	});

	it("serves the local web UI shell", async () => {
		const base = `http://127.0.0.1:${f.handle.port}`;
		const html = await fetch(`${base}/`);
		expect(html.status).toBe(200);
		expect(html.headers.get("content-type")).toContain("text/html");
		expect(await html.text()).toContain("Me Write Code");

		const js = await fetch(`${base}/web/app.js`);
		expect(js.status).toBe(200);
		expect(js.headers.get("content-type")).toContain("text/javascript");
	});

	it("rejects non-loopback host headers when unauthenticated", async () => {
		const response = await fetch(`http://127.0.0.1:${f.handle.port}/v1/health`, {
			headers: {
				host: `evil.example:${f.handle.port}`,
				origin: `http://evil.example:${f.handle.port}`,
			},
		});
		expect(response.status).toBe(403);
	});

	it("rejects non-loopback unauthenticated daemon startup", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-host-"));
		const store = openStore(join(tmpDir, "sessions.db"));
		try {
			await expect(
				startDaemon({
					host: "0.0.0.0",
					port: 0,
					store,
					runnerFactory: createDefaultRunnerFactory({ tokensPerSecond: 2000 }),
				}),
			).rejects.toThrow(/token is required/);
		} finally {
			store.close();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("WS9 daemon — REST routing", () => {
	let f: Fixture;
	beforeEach(async () => {
		f = await bootDaemon();
	});
	afterEach(async () => {
		await shutdown(f);
	});

	it("creates, gets, lists, and deletes a session", async () => {
		const created = await f.client.createSession({ cwd: "/tmp", title: "demo" });
		expect(created.id).toBeTruthy();
		expect(created.state).toBe("idle");
		expect(created.title).toBe("demo");

		const fetched = await f.client.getSession(created.id);
		expect(fetched.id).toBe(created.id);

		const list = await f.client.listSessions();
		expect(list.find((s) => s.id === created.id)).toBeDefined();

		await f.client.deleteSession(created.id);
		await expect(f.client.getSession(created.id)).rejects.toThrow(/404|not found/);
	});

	it("returns transcript for a session", async () => {
		const s = await f.client.createSession({});
		const msg = await f.client.send(s.id, { text: "hello" });
		expect(msg.role).toBe("user");
		// Poll until the runner has streamed + persisted the assistant reply rather
		// than sleeping a fixed window (which races on a loaded CI box).
		const transcript = await vi.waitFor(
			async () => {
				const t = await f.client.getTranscript(s.id);
				expect(t.messages.some((m) => m.role === "assistant")).toBe(true);
				return t;
			},
			{ timeout: 5000, interval: 25 },
		);
		expect(transcript.messages.length).toBeGreaterThanOrEqual(1);
		expect(transcript.messages[0].text).toBe("hello");
	});

	it("persists runner state events without attached WebSocket clients", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-state-"));
		const store = openStore(join(tmpDir, "sessions.db"));
		try {
			const handle = await startDaemon({
				host: "127.0.0.1",
				port: 0,
				store,
				runnerFactory: (session, emit) => ({
					async send(text) {
						emit({ type: "state", sessionId: session.id, state: "stopped" });
						return {
							id: "m_user",
							sessionId: session.id,
							role: "user",
							text,
							createdAt: new Date().toISOString(),
						};
					},
					interrupt() {},
					close() {},
				}),
				version: "test",
			});
			try {
				const client = new CaveClient({ host: handle.host, port: handle.port });
				const session = await client.createSession({});
				await client.send(session.id, { text: "pause" });
				await expect(client.getSession(session.id)).resolves.toMatchObject({ state: "stopped" });
			} finally {
				await handle.close();
			}
		} finally {
			store.close();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("rejects unknown routes with 404", async () => {
		await expect(fetch(`http://127.0.0.1:${f.handle.port}/v1/nope`).then((r) => r.status)).resolves.toBe(404);
	});

	it("rejects unexpected browser origins for API requests", async () => {
		const response = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions`, {
			headers: { origin: "http://evil.example" },
		});
		expect(response.status).toBe(403);
	});

	it("lists and reads files under the session cwd", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		try {
			mkdirSync(join(cwd, "src"));
			writeFileSync(join(cwd, "README.md"), "hello\n", "utf8");
			writeFileSync(join(cwd, "src", "app.ts"), "export const ok = true;\n", "utf8");
			writeFileSync(join(cwd, ".env"), "SECRET=1\n", "utf8");
			const session = await f.client.createSession({ cwd });

			const tree = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/tree`);
			expect(tree.status).toBe(200);
			const body = (await tree.json()) as { entries: Array<{ name: string; type: string }> };
			expect(body.entries.map((entry) => entry.name)).toEqual(["src", "README.md"]);

			const read = await fetch(
				`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read?path=src%2Fapp.ts`,
			);
			expect(read.status).toBe(200);
			await expect(read.json()).resolves.toMatchObject({ path: "src/app.ts", text: "export const ok = true;\n" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects unsafe file paths", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		const outside = mkdtempSync(join(tmpdir(), "cave-daemon-outside-"));
		try {
			writeFileSync(join(cwd, "ok.txt"), "ok", "utf8");
			writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
			symlinkSync(outside, join(cwd, "outside-link"));
			mkdirSync(join(cwd, ".git"));
			mkdirSync(join(cwd, ".aws"));
			writeFileSync(join(cwd, ".env.production"), "SECRET=1\n", "utf8");
			writeFileSync(join(cwd, ".git", "config"), "[remote]\n", "utf8");
			writeFileSync(join(cwd, ".aws", "credentials"), "secret\n", "utf8");
			symlinkSync(join(cwd, ".aws"), join(cwd, "aws-dir-link"));
			symlinkSync(join(cwd, ".aws", "credentials"), join(cwd, "creds-link"));
			writeFileSync(join(cwd, "private.pem"), "secret\n", "utf8");
			writeFileSync(join(cwd, "binary.bin"), Buffer.from([0, 1, 2]));
			writeFileSync(join(cwd, "bad-utf8.txt"), Buffer.from([0xc3, 0x28]));
			writeFileSync(join(cwd, "large.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
			const session = await f.client.createSession({ cwd });
			const base = `http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read`;
			const treeBase = `http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/tree`;

			await expect(fetch(`${base}?path=..%2Fsecret.txt`).then((r) => r.status)).resolves.toBe(400);
			await expect(fetch(`${base}?path=%2Ftmp%2Fsecret.txt`).then((r) => r.status)).resolves.toBe(400);
			await expect(fetch(`${base}?path=outside-link%2Fsecret.txt`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=.env.production`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=.git%2Fconfig`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=.aws%2Fcredentials`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=creds-link`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${treeBase}?path=aws-dir-link`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=private.pem`).then((r) => r.status)).resolves.toBe(403);
			await expect(fetch(`${base}?path=binary.bin`).then((r) => r.status)).resolves.toBe(415);
			await expect(fetch(`${base}?path=bad-utf8.txt`).then((r) => r.status)).resolves.toBe(415);
			await expect(fetch(`${base}?path=large.txt`).then((r) => r.status)).resolves.toBe(413);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("writes files under the session cwd with conflict checks", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		try {
			const filePath = join(cwd, "edit.txt");
			writeFileSync(filePath, "before\n", "utf8");
			writeFileSync(join(cwd, "tokens.test.ts"), "const tokenCount = 1;\n", "utf8");
			const session = await f.client.createSession({ cwd });
			const read = await fetch(
				`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read?path=edit.txt`,
			);
			const snapshot = (await read.json()) as { mtimeMs: number; size: number };

			const write = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/write`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: "edit.txt",
					text: "after\n",
					expectedMtimeMs: snapshot.mtimeMs,
					expectedSize: snapshot.size,
				}),
			});
			expect(write.status).toBe(200);
			expect(readFileSync(filePath, "utf8")).toBe("after\n");

			const conflict = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/write`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: "edit.txt",
					text: "stale\n",
					expectedMtimeMs: snapshot.mtimeMs,
					expectedSize: snapshot.size,
				}),
			});
			expect(conflict.status).toBe(409);

			const tokenRead = await fetch(
				`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read?path=tokens.test.ts`,
			);
			const tokenSnapshot = (await tokenRead.json()) as { mtimeMs: number; size: number };
			const quoteHeavyText = `const quoted = "${'\\"'.repeat(100_000)}";\n`;
			const tokenWrite = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/write`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: "tokens.test.ts",
					text: quoteHeavyText,
					expectedMtimeMs: tokenSnapshot.mtimeMs,
					expectedSize: tokenSnapshot.size,
				}),
			});
			expect(tokenWrite.status).toBe(200);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("serializes concurrent file writes with the same precondition", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		try {
			const filePath = join(cwd, "edit.txt");
			writeFileSync(filePath, "before\n", "utf8");
			const session = await f.client.createSession({ cwd });
			const read = await fetch(
				`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read?path=edit.txt`,
			);
			const snapshot = (await read.json()) as { mtimeMs: number; size: number };
			const write = (text: string) =>
				fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/write`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						path: "edit.txt",
						text,
						expectedMtimeMs: snapshot.mtimeMs,
						expectedSize: snapshot.size,
					}),
				}).then((r) => r.status);

			const statuses = await Promise.all([write("first\n"), write("second\n")]);
			expect(statuses.sort()).toEqual([200, 409]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects unsafe file writes", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		const outside = mkdtempSync(join(tmpdir(), "cave-daemon-outside-"));
		try {
			writeFileSync(join(cwd, "ok.txt"), "ok", "utf8");
			mkdirSync(join(cwd, ".aws"));
			writeFileSync(join(cwd, ".aws", "credentials"), "secret", "utf8");
			symlinkSync(join(outside, "secret.txt"), join(cwd, "outside-link"));
			writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
			const session = await f.client.createSession({ cwd });
			const url = `http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/write`;
			const read = await fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/read?path=ok.txt`);
			const snapshot = (await read.json()) as { mtimeMs: number; size: number };
			const write = (path: string, text = "x") =>
				fetch(url, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						path,
						text,
						expectedMtimeMs: snapshot.mtimeMs,
						expectedSize: snapshot.size,
					}),
				}).then((r) => r.status);
			const writeWithoutPrecondition = () =>
				fetch(url, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path: "ok.txt", text: "x" }),
				}).then((r) => r.status);

			await expect(writeWithoutPrecondition()).resolves.toBe(400);
			await expect(write("../bad.txt")).resolves.toBe(400);
			await expect(write("/tmp/bad.txt")).resolves.toBe(400);
			await expect(write(".aws/credentials")).resolves.toBe(403);
			await expect(write("outside-link")).resolves.toBe(403);
			await expect(write("ok.txt", "\0")).resolves.toBe(415);
			await expect(write("ok.txt", "a".repeat(1024 * 1024 + 1))).resolves.toBe(413);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("rejects oversized directory listings", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cave-daemon-files-"));
		try {
			for (let i = 0; i < 1001; i++) writeFileSync(join(cwd, `f-${i}.txt`), "x", "utf8");
			const session = await f.client.createSession({ cwd });
			await expect(
				fetch(`http://127.0.0.1:${f.handle.port}/v1/sessions/${session.id}/files/tree`).then((r) => r.status),
			).resolves.toBe(413);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("lists directories at an absolute path for the folder picker", async () => {
		const root = mkdtempSync(join(tmpdir(), "cave-fs-list-"));
		try {
			mkdirSync(join(root, "alpha"));
			mkdirSync(join(root, "beta"));
			mkdirSync(join(root, ".ssh"));
			writeFileSync(join(root, "note.txt"), "hi", "utf8");
			const response = await fetch(`http://127.0.0.1:${f.handle.port}/v1/fs/list?path=${encodeURIComponent(root)}`);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				path: string;
				parent: string | null;
				home: string;
				entries: { name: string; type: string }[];
			};
			expect(body.parent).not.toBeNull();
			expect(body.home).toBeTruthy();
			expect(body.entries.every((entry) => entry.type === "directory")).toBe(true);
			const names = body.entries.map((entry) => entry.name);
			expect(names).toEqual(["alpha", "beta"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("defaults the folder picker to $HOME when no path is supplied", async () => {
		const response = await fetch(`http://127.0.0.1:${f.handle.port}/v1/fs/list`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { path: string; home: string };
		expect(body.path).toBe(body.home);
	});

	it("rejects relative folder-picker paths", async () => {
		const response = await fetch(
			`http://127.0.0.1:${f.handle.port}/v1/fs/list?path=${encodeURIComponent("relative/path")}`,
		);
		expect(response.status).toBe(400);
	});

	it("reports 404 when the picker path does not exist", async () => {
		const response = await fetch(
			`http://127.0.0.1:${f.handle.port}/v1/fs/list?path=${encodeURIComponent("/does/not/exist/xyz-cave")}`,
		);
		expect(response.status).toBe(404);
	});
});

describe("WS9 daemon — SQLite round-trip survives restart", () => {
	it("retains sessions and transcripts across restart", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-restart-"));
		const dbPath = join(tmpDir, "sessions.db");
		try {
			// Boot, write some state, shut down.
			const store1 = openStore(dbPath);
			const h1 = await startDaemon({
				host: "127.0.0.1",
				port: 0,
				store: store1,
				runnerFactory: createDefaultRunnerFactory({ tokensPerSecond: 2000 }),
				version: "test",
			});
			const c1 = new CaveClient({ host: h1.host, port: h1.port });
			const s = await c1.createSession({ title: "persisted" });
			await c1.send(s.id, { text: "hi" });
			// Wait for the assistant reply to be persisted before restarting, instead
			// of a fixed sleep, so the round-trip assertion is deterministic.
			await vi.waitFor(
				async () => {
					const t = await c1.getTranscript(s.id);
					expect(t.messages.some((m) => m.role === "assistant")).toBe(true);
				},
				{ timeout: 5000, interval: 25 },
			);
			await h1.close();
			store1.close();

			// Re-open with a new daemon pointing at the same db.
			const store2 = openStore(dbPath);
			const h2 = await startDaemon({
				host: "127.0.0.1",
				port: 0,
				store: store2,
				runnerFactory: createDefaultRunnerFactory({ tokensPerSecond: 2000 }),
				version: "test",
			});
			const c2 = new CaveClient({ host: h2.host, port: h2.port });
			const fetched = await c2.getSession(s.id);
			expect(fetched.title).toBe("persisted");
			const transcript = await c2.getTranscript(s.id);
			expect(transcript.messages.length).toBeGreaterThanOrEqual(1);
			expect(transcript.messages[0].text).toBe("hi");
			await h2.close();
			store2.close();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("WS9 daemon — WebSocket streaming", () => {
	let f: Fixture;
	beforeEach(async () => {
		f = await bootDaemon();
	});
	afterEach(async () => {
		await shutdown(f);
	});

	it("streams tokens to an attached WS client and emits done", async () => {
		const s = await f.client.createSession({});
		const session = f.client.attach(s.id);
		await session.ready();

		const tokens: string[] = [];
		const states: string[] = [];
		const done = new Promise<void>((resolve) => {
			session.on("token", (p) => {
				if (typeof p?.text === "string") tokens.push(p.text);
			});
			session.on("state", (p) => {
				if (typeof p?.state === "string") states.push(p.state);
			});
			session.on("done", () => resolve());
		});

		await session.send("ping");
		await done;
		const joined = tokens.join("");
		expect(joined.length).toBeGreaterThan(0);
		expect(joined).toContain("ping");
		// Should see at least running → idle.
		expect(states).toContain("running");
		expect(states).toContain("idle");
		session.close();
	});

	it("rejects unexpected browser origins for WebSocket streams", async () => {
		const s = await f.client.createSession({});
		await expect(
			new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://127.0.0.1:${f.handle.port}/v1/sessions/${s.id}/stream`, {
					headers: { origin: "http://evil.example" },
				});
				ws.once("open", () => {
					ws.close();
					reject(new Error("unexpected open"));
				});
				ws.once("error", () => resolve());
			}),
		).resolves.toBeUndefined();
	});

	it("rejects matching hostile host and origin for WebSocket streams", async () => {
		const s = await f.client.createSession({});
		await expect(
			new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://127.0.0.1:${f.handle.port}/v1/sessions/${s.id}/stream`, {
					headers: {
						host: `evil.example:${f.handle.port}`,
						origin: `http://evil.example:${f.handle.port}`,
					},
				});
				ws.once("open", () => {
					ws.close();
					reject(new Error("unexpected open"));
				});
				ws.once("error", () => resolve());
			}),
		).resolves.toBeUndefined();
	});

	it("routes approval requests to approval-capable WebSocket clients", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-approval-"));
		const store = openStore(join(tmpDir, "sessions.db"));
		let decision: string | undefined;
		try {
			const handle = await startDaemon({
				host: "127.0.0.1",
				port: 0,
				store,
				version: "test",
				runnerFactory: (session, emit) => ({
					async send(text) {
						emit({
							type: "approval",
							sessionId: session.id,
							approvalId: "approval-1",
							toolName: "write",
							args: { path: "file.txt" },
							tier: "write",
						});
						return {
							id: "m_user",
							sessionId: session.id,
							role: "user",
							text,
							createdAt: new Date().toISOString(),
						};
					},
					interrupt() {},
					close() {},
					respondApproval(_approvalId, nextDecision) {
						decision = nextDecision;
					},
				}),
			});
			try {
				const client = new CaveClient({ host: handle.host, port: handle.port });
				const session = await client.createSession({});
				let ws: WebSocket | undefined;
				await expect(
					new Promise<void>((resolve, reject) => {
						const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/v1/sessions/${session.id}/stream`);
						ws = socket;
						let id = 1;
						socket.once("open", () => {
							socket.send(
								JSON.stringify({
									jsonrpc: "2.0",
									id: id++,
									method: "client_capabilities",
									params: { approval: true },
								}),
							);
							socket.send(JSON.stringify({ jsonrpc: "2.0", id: id++, method: "send", params: { text: "go" } }));
						});
						socket.on("message", (raw) => {
							const envelope = JSON.parse(raw.toString()) as {
								method?: string;
								params?: { approvalId?: string };
							};
							if (envelope.method !== "approval") return;
							socket.send(
								JSON.stringify({
									jsonrpc: "2.0",
									id: id++,
									method: "approval_decision",
									params: { approvalId: envelope.params?.approvalId, decision: "once" },
								}),
							);
							resolve();
						});
						socket.once("error", reject);
					}),
				).resolves.toBeUndefined();
				await expect.poll(() => decision).toBe("once");
				ws?.close();
			} finally {
				await handle.close();
			}
		} finally {
			store.close();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("supports multiple clients attached to the same session", async () => {
		const s = await f.client.createSession({});
		const a = f.client.attach(s.id);
		const b = f.client.attach(s.id);
		await Promise.all([a.ready(), b.ready()]);

		const tokensA: string[] = [];
		const tokensB: string[] = [];
		const doneA = new Promise<void>((res) => {
			a.on("token", (p) => p?.text && tokensA.push(p.text));
			a.on("done", () => res());
		});
		const doneB = new Promise<void>((res) => {
			b.on("token", (p) => p?.text && tokensB.push(p.text));
			b.on("done", () => res());
		});

		await a.send("multi");
		await Promise.all([doneA, doneB]);

		expect(tokensA.join("")).toContain("multi");
		expect(tokensB.join("")).toContain("multi");
		a.close();
		b.close();
	});
});

describe("WS9 daemon — worker registry (HTTP)", () => {
	let f: Fixture;
	beforeEach(async () => {
		f = await bootDaemon();
	});
	afterEach(async () => {
		await shutdown(f);
	});

	it("registers, lists, and removes a worker", async () => {
		const w = await f.client.registerWorker({
			name: "gpu-1",
			url: "http://10.0.0.5:7421",
			labels: { region: "us-east" },
		});
		expect(w.name).toBe("gpu-1");
		expect(w.registeredAt).toBeTruthy();

		const list = await f.client.listWorkers();
		expect(list.find((x) => x.name === "gpu-1")).toBeDefined();

		await f.client.removeWorker("gpu-1");
		const after = await f.client.listWorkers();
		expect(after.find((x) => x.name === "gpu-1")).toBeUndefined();
	});
});

describe("WS9 daemon — bearer auth", () => {
	it("rejects requests without the configured token", async () => {
		const f = await bootDaemon({ token: "secret" });
		try {
			const noAuth = new CaveClient({ host: f.handle.host, port: f.handle.port });
			await expect(noAuth.listSessions()).rejects.toThrow(/401|unauthorized/);
			// /v1/health does not require auth (liveness probe).
			await expect(noAuth.health()).resolves.toMatchObject({ ok: true });
			// With the right token, it works.
			const ok = new CaveClient({ host: f.handle.host, port: f.handle.port, token: "secret" });
			const s = await ok.createSession({});
			expect(s.id).toBeTruthy();
		} finally {
			await shutdown(f);
		}
	});

	it("accepts bearer token through WebSocket subprotocols", async () => {
		const f = await bootDaemon({ token: "secret" });
		try {
			const ok = new CaveClient({ host: f.handle.host, port: f.handle.port, token: "secret" });
			const s = await ok.createSession({});
			await expect(
				new Promise<void>((resolve, reject) => {
					const encoded = Buffer.from("secret", "utf8").toString("base64url");
					const ws = new WebSocket(`ws://127.0.0.1:${f.handle.port}/v1/sessions/${s.id}/stream`, [
						"mewrite-auth",
						`mewrite-bearer.${encoded}`,
					]);
					ws.once("open", () => {
						ws.close();
						resolve();
					});
					ws.once("error", reject);
				}),
			).resolves.toBeUndefined();
		} finally {
			await shutdown(f);
		}
	});
});
