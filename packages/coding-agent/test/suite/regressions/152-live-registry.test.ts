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
