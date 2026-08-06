/**
 * #158 phase 4 — spawn agents from `mewrite agents` + auto-start the daemon.
 *
 * Covers ensureDaemon (health-ok fast path, auto-start + health-poll, spawn-timeout
 * honest failure, race where a peer binds during our poll, non-loopback no-spawn)
 * and spawnAgent (createSession(cwd)+send, empty-task no-op).
 */

import { setKeybindings } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type AgentsArgs, type DaemonSpawner, ensureDaemon, spawnAgent } from "../../../src/cli/agents.js";
import type { CaveClient, Health, MessageRecord, SessionRecord } from "../../../src/core/daemon/index.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";

const LOOPBACK: AgentsArgs = { host: "127.0.0.1", port: 7421 };

const okHealth: Health = {
	ok: true,
	version: "test",
	uptimeSec: 1,
	capabilities: { runnerKind: "agent", approvalSupported: true },
};

/** A client whose health() follows a scripted sequence of ok/throw. */
function scriptedClient(healthResults: Array<"ok" | "down">): CaveClient {
	let i = 0;
	return {
		health: vi.fn(async () => {
			const r = healthResults[Math.min(i, healthResults.length - 1)];
			i++;
			if (r === "down") {
				const err = new Error("fetch failed");
				(err as { cause?: unknown }).cause = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
				throw err;
			}
			return okHealth;
		}),
	} as unknown as CaveClient;
}

function neverSpawner(): DaemonSpawner {
	return vi.fn(() => ({ getStderr: () => "", cleanup: () => {} })) as unknown as DaemonSpawner;
}

describe("#158 ensureDaemon", () => {
	it("returns the client without spawning when the daemon is already healthy", async () => {
		const client = scriptedClient(["ok"]);
		const spawner = neverSpawner();
		const res = await ensureDaemon(LOOPBACK, client, spawner, 500);
		expect("client" in res).toBe(true);
		expect(spawner).not.toHaveBeenCalled();
	});

	it("auto-starts and returns the client once health comes up", async () => {
		// down (initial probe), down (first poll), ok (second poll)
		const client = scriptedClient(["down", "down", "ok"]);
		const cleanup = vi.fn();
		const spawner = vi.fn(() => ({ getStderr: () => "", cleanup })) as unknown as DaemonSpawner;
		const res = await ensureDaemon(LOOPBACK, client, spawner, 2000);
		expect("client" in res).toBe(true);
		expect(spawner).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("fails honestly with serve stderr when health never comes up", async () => {
		const client = scriptedClient(["down"]); // always down
		const spawner = vi.fn(() => ({
			getStderr: () => "Error: failed to bind 127.0.0.1:7421: EADDRINUSE",
			cleanup: () => {},
		})) as unknown as DaemonSpawner;
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await ensureDaemon(LOOPBACK, client, spawner, 300);
		const printed = errSpy.mock.calls.flat().join(" ");
		errSpy.mockRestore();
		expect(res).toEqual({ code: 2 });
		expect(printed).toContain("EADDRINUSE");
	});

	it("treats a peer that binds during our poll as success (race)", async () => {
		// down (probe), down (poll until timeout), then ok on the post-timeout recheck
		const client = scriptedClient(["down", "down", "ok"]);
		const cleanup = vi.fn();
		const spawner = vi.fn(() => ({ getStderr: () => "", cleanup })) as unknown as DaemonSpawner;
		// Tiny timeout so we hit the post-timeout recheck path.
		const res = await ensureDaemon(LOOPBACK, client, spawner, 0);
		expect("client" in res).toBe(true);
		expect(cleanup).toHaveBeenCalled();
	});

	it("does not auto-start on a non-loopback host", async () => {
		const client = scriptedClient(["down"]);
		const spawner = neverSpawner();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await ensureDaemon({ host: "10.0.0.5", port: 7421 }, client, spawner, 300);
		errSpy.mockRestore();
		expect(res).toEqual({ code: 2 });
		expect(spawner).not.toHaveBeenCalled();
	});
});

describe("#158 spawnAgent", () => {
	beforeAll(() => setKeybindings(KeybindingsManager.create()));

	it("creates a session in the given cwd and sends the task", async () => {
		const created: SessionRecord = {
			id: "new-1",
			cwd: "/tmp/proj",
			state: "running",
			createdAt: "",
			updatedAt: "",
		};
		const createSession = vi.fn(async () => created);
		const send = vi.fn(async () => ({ id: "m1" }) as MessageRecord);
		const client = { createSession, send } as unknown as Pick<CaveClient, "createSession" | "send">;

		const res = await spawnAgent(client, "/tmp/proj", "  do the thing  ");
		expect(res).toEqual(created);
		expect(createSession).toHaveBeenCalledWith({ cwd: "/tmp/proj" });
		expect(send).toHaveBeenCalledWith("new-1", { text: "do the thing" });
	});

	it("no-ops on an empty task (does not create or send)", async () => {
		const createSession = vi.fn();
		const send = vi.fn();
		const client = { createSession, send } as unknown as Pick<CaveClient, "createSession" | "send">;
		const res = await spawnAgent(client, "/tmp/proj", "   ");
		expect(res).toBeNull();
		expect(createSession).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
});
