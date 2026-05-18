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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
		// give the runner a moment to stream + persist the assistant reply
		await new Promise((r) => setTimeout(r, 200));
		const transcript = await f.client.getTranscript(s.id);
		expect(transcript.messages.length).toBeGreaterThanOrEqual(1);
		expect(transcript.messages[0].text).toBe("hello");
	});

	it("rejects unknown routes with 404", async () => {
		await expect(fetch(`http://127.0.0.1:${f.handle.port}/v1/nope`).then((r) => r.status)).resolves.toBe(404);
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
			await new Promise((r) => setTimeout(r, 200));
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
});
