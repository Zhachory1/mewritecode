/**
 * #152 phase 2 — interactive session liveness registry.
 *
 * Covers the writer (attachLiveRegistry): file creation w/ 0600, running<->idle
 * flips on stream transitions, dispose unlink, and best-effort behaviour; and
 * the reader (listLiveInteractive): reaping dead-pid / stale-mtime / torn-json.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../../src/core/agent-session.js";
import {
	attachLiveRegistry,
	deriveSessionTitle,
	getLiveDir,
	type LiveRecord,
	listLiveInteractive,
} from "../../../src/core/live-registry.js";

const ENV_AGENT_DIR = "MEWRITE_CODING_AGENT_DIR";
/** A pid that will not exist on any sane system. */
const DEAD_PID = 2 ** 31 - 1;

let tempDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
	prevAgentDir = process.env[ENV_AGENT_DIR];
	tempDir = join(tmpdir(), `live-reg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	process.env[ENV_AGENT_DIR] = tempDir;
	delete process.env.MEWRITE_NO_LIVE;
});

afterEach(() => {
	if (prevAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = prevAgentDir;
	rmSync(tempDir, { recursive: true, force: true });
});

/** Minimal AgentSession stand-in with a controllable streaming flag. */
function fakeSession(id: string): {
	session: AgentSession;
	setStreaming: (v: boolean) => void;
} {
	let streaming = false;
	const listeners: Array<() => void> = [];
	const session = {
		get sessionId() {
			return id;
		},
		get isStreaming() {
			return streaming;
		},
		subscribe(listener: () => void) {
			listeners.push(listener);
			return () => {
				const i = listeners.indexOf(listener);
				if (i >= 0) listeners.splice(i, 1);
			};
		},
	} as unknown as AgentSession;
	return {
		session,
		setStreaming: (v: boolean) => {
			streaming = v;
			for (const l of listeners) l();
		},
	};
}

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 1000): Promise<void> {
	const start = Date.now();
	while (!(await pred())) {
		if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
		await new Promise((r) => setTimeout(r, 10));
	}
}

async function readRecord(id: string): Promise<LiveRecord> {
	const path = join(getLiveDir(), `${id}.json`);
	return JSON.parse(await readFile(path, "utf8")) as LiveRecord;
}

async function stateOf(id: string): Promise<string> {
	return (await readRecord(id)).state;
}

describe("#152 live-registry writer", () => {
	it("creates a 0600 file with idle state and flips to running on stream start/stop", async () => {
		const { session, setStreaming } = fakeSession("write-1");
		const dispose = attachLiveRegistry(session, "/tmp/proj");
		try {
			const path = join(getLiveDir(), "write-1.json");
			await waitFor(() => existsSync(path));
			const st = await stat(path);
			expect(st.mode & 0o777).toBe(0o600);
			await waitFor(async () => (await stateOf("write-1")) === "idle");

			setStreaming(true);
			await waitFor(async () => (await stateOf("write-1")) === "running");
			const running = await readRecord("write-1");
			expect(running.pid).toBe(process.pid);
			expect(running.cwd).toBe("/tmp/proj");

			setStreaming(false);
			await waitFor(async () => (await stateOf("write-1")) === "idle");
		} finally {
			dispose();
		}
	});

	it("writes a derived title from the last user message (#174, #220)", async () => {
		const { session } = fakeSession("write-title");
		(session as unknown as { state: { messages: unknown[] } }).state = {
			messages: [{ role: "user", content: "fix the flaky steering inbox test in CI please" }],
		};
		const dispose = attachLiveRegistry(session, "/tmp/proj");
		try {
			await waitFor(() => existsSync(join(getLiveDir(), "write-title.json")));
			await waitFor(async () => (await readRecord("write-title")).title !== undefined);
			// First line, clamped to 100 chars (here the whole line fits).
			expect((await readRecord("write-title")).title).toBe("fix the flaky steering inbox test in CI please");
		} finally {
			dispose();
		}
	});

	it("dispose unlinks the file", async () => {
		const { session } = fakeSession("write-2");
		const dispose = attachLiveRegistry(session, "/tmp/proj");
		const path = join(getLiveDir(), "write-2.json");
		await waitFor(() => existsSync(path));
		dispose();
		await waitFor(() => !existsSync(path));
		expect(existsSync(path)).toBe(false);
	});

	it("MEWRITE_NO_LIVE opt-out writes nothing", async () => {
		process.env.MEWRITE_NO_LIVE = "1";
		const { session } = fakeSession("write-3");
		const dispose = attachLiveRegistry(session, "/tmp/proj");
		await new Promise((r) => setTimeout(r, 50));
		expect(existsSync(join(getLiveDir(), "write-3.json"))).toBe(false);
		dispose();
	});
});

describe("#152 listLiveInteractive reader", () => {
	async function seed(id: string, rec: Partial<LiveRecord>, mtimeMs?: number): Promise<string> {
		mkdirSync(getLiveDir(), { recursive: true });
		const path = join(getLiveDir(), `${id}.json`);
		const full: LiveRecord = {
			id,
			pid: process.pid,
			cwd: `/tmp/${id}`,
			state: "idle",
			updatedAt: new Date().toISOString(),
			...rec,
		};
		await writeFile(path, JSON.stringify(full));
		if (mtimeMs !== undefined) {
			const t = mtimeMs / 1000;
			await utimes(path, t, t);
		}
		return path;
	}

	it("returns only alive+fresh records and reaps dead/stale/torn files", async () => {
		const alivePath = await seed("alive", { pid: process.pid });
		const deadPath = await seed("dead", { pid: DEAD_PID });
		const stalePath = await seed("stale", { pid: process.pid }, Date.now() - 60_000);
		const tornPath = join(getLiveDir(), "torn.json");
		await writeFile(tornPath, "{not valid json");

		const rows = await listLiveInteractive();
		expect(rows.map((r) => r.id)).toEqual(["alive"]);

		expect(existsSync(alivePath)).toBe(true);
		expect(existsSync(deadPath)).toBe(false);
		expect(existsSync(stalePath)).toBe(false);
		expect(existsSync(tornPath)).toBe(false);
	});

	it("returns empty when the live dir does not exist", async () => {
		rmSync(getLiveDir(), { recursive: true, force: true });
		expect(await listLiveInteractive()).toEqual([]);
	});
});

describe("#174 deriveSessionTitle", () => {
	function sessionWith(opts: { name?: string; messages?: unknown[] }): Parameters<typeof deriveSessionTitle>[0] {
		return {
			sessionName: opts.name,
			state: { messages: opts.messages ?? [] },
		} as unknown as Parameters<typeof deriveSessionTitle>[0];
	}

	it("prefers an explicit session name over a derived title", () => {
		const s = sessionWith({ name: "my agent", messages: [{ role: "user", content: "do something else" }] });
		expect(deriveSessionTitle(s)).toBe("my agent");
	});

	it("#220 derives from the last user message, first line", () => {
		const s = sessionWith({
			messages: [
				{ role: "user", content: "open the session" },
				{ role: "assistant", content: "hello" },
				{ role: "user", content: "one two three four five six seven eight\nsecond line" },
			],
		});
		expect(deriveSessionTitle(s)).toBe("one two three four five six seven eight");
	});

	it("joins text blocks from structured content", () => {
		const s = sessionWith({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "refactor the" },
						{ type: "image", data: "..." },
						{ type: "text", text: "parser module" },
					],
				},
			],
		});
		expect(deriveSessionTitle(s)).toBe("refactor the parser module");
	});

	it("#220 clamps to the first 100 chars with an ellipsis", () => {
		const long = "x".repeat(200);
		const s = sessionWith({ messages: [{ role: "user", content: long }] });
		const title = deriveSessionTitle(s);
		expect(title?.length).toBe(100);
		expect(title?.endsWith("…")).toBe(true);
	});

	it("#220 tracks a later steer/redirect user message", () => {
		const s = sessionWith({
			messages: [
				{ role: "user", content: "start on the auth bug" },
				{ role: "assistant", content: "on it" },
				{ role: "user", content: "actually switch to the parser" },
			],
		});
		expect(deriveSessionTitle(s)).toBe("actually switch to the parser");
	});

	it("returns undefined with no user messages (falls back to cwd/id in the view)", () => {
		expect(deriveSessionTitle(sessionWith({}))).toBeUndefined();
		expect(deriveSessionTitle(sessionWith({ messages: [{ role: "assistant", content: "hi" }] }))).toBeUndefined();
	});

	it("never throws on a malformed session (best-effort)", () => {
		expect(deriveSessionTitle({} as Parameters<typeof deriveSessionTitle>[0])).toBeUndefined();
	});
});
