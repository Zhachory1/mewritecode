/**
 * #176 — daemon shutdown must not throw "The database connection is not open".
 *
 * The default echo runner streams its reply from an un-awaited async task. If the
 * daemon is closed (and its SQLite store closed) while that task is mid-stream, a
 * late `state`/`message` emit used to call `store.updateSession` on a dead
 * connection and throw an unhandled TypeError. `close()` now latches a `closed`
 * flag so the per-session emitter drops late events.
 *
 * Repro: boot a real daemon with a slow token stream, kick off a turn, then close
 * the handle + store while tokens are still flowing and assert nothing throws.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStore } from "../../../src/core/daemon/index.js";
import {
	CaveClient,
	createDefaultRunnerFactory,
	type DaemonHandle,
	openStore,
	startDaemon,
} from "../../../src/core/daemon/index.js";

describe("#176 daemon close store race", () => {
	let tmpDir: string;
	let store: SessionStore;
	let handle: DaemonHandle;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cave-daemon-race-"));
		store = openStore(join(tmpDir, "sessions.db"));
		handle = await startDaemon({
			host: "127.0.0.1",
			port: 0,
			store,
			// Slow stream so the turn is guaranteed still in-flight when we close.
			runnerFactory: createDefaultRunnerFactory({ tokensPerSecond: 20 }),
			version: "test",
		});
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not touch the closed store when a runner emits after close()", async () => {
		const client = new CaveClient({ host: handle.host, port: handle.port });
		const session = await client.createSession({});

		const errors: unknown[] = [];
		const onUnhandled = (err: unknown): void => {
			errors.push(err);
		};
		process.on("unhandledRejection", onUnhandled);
		process.on("uncaughtException", onUnhandled);
		const updateSpy = vi.spyOn(store, "updateSession");

		try {
			// Kick off a multi-token reply; returns 202 immediately, stream continues.
			await client.send(session.id, { text: "hello there general kenobi" });
			// Close mid-stream (handle first, then the store) to recreate the race.
			await handle.close();
			store.close();
			// Let any queued/late emits fire against the now-closed store.
			await new Promise((r) => setTimeout(r, 100));

			// The emitter must have stopped calling updateSession once closed, so no
			// call throws on the dead connection.
			for (const call of updateSpy.mock.results) {
				expect(call.type).not.toBe("throw");
			}
			expect(errors).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
			process.off("uncaughtException", onUnhandled);
			updateSpy.mockRestore();
		}
	});
});
