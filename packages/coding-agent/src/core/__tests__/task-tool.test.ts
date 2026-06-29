/**
 * WS6 Task tool — end-to-end smoke. Verifies the subagent spawn → JSON-mode
 * parse → fold-back loop without spawning a real `cave` subprocess.
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadAgentDefsResult } from "../agent-defs/loader.js";
import { _resetRegistry, getBackground } from "../background-task-registry.js";
import { createTaskToolDefinition } from "../tools/task.js";

function fakeChild(jsonLines: string[], exitCode = 0): any {
	const child = new EventEmitter() as any;
	child.stdout = Readable.from(jsonLines.map((l) => `${l}\n`));
	child.stderr = Readable.from([]);
	child.killed = false;
	child.kill = () => {
		child.killed = true;
	};
	// Emit close after stdout drains. EventEmitter doesn't await, so schedule
	// via setImmediate so the consumer sees stdout first.
	setImmediate(() => child.emit("close", exitCode));
	return child;
}

const stubLoaded: LoadAgentDefsResult = {
	agents: [
		{
			def: {
				name: "tester",
				description: "Test agent",
				prompt: "You are a tester.",
				tools: ["read"],
				model: undefined,
				isolation: "none",
				source: "user",
				filePath: "<test:tester>",
			},
			sourceInfo: {
				path: "<test:tester>",
				metadata: { source: "synthetic", scope: "user", origin: "synthetic" },
			} as any,
		},
	],
	diagnostics: [],
};

const agentDirEnv = "CAVEMAN-CODE_CODING_AGENT_DIR";
let tmpAgentDir: string;

describe("WS6 Task tool", () => {
	beforeEach(() => {
		tmpAgentDir = mkdtempSync(join(tmpdir(), "cave-task-core-test-"));
		process.env[agentDirEnv] = tmpAgentDir;
	});

	afterEach(() => {
		delete process.env[agentDirEnv];
		if (tmpAgentDir && existsSync(tmpAgentDir)) rmSync(tmpAgentDir, { recursive: true, force: true });
	});

	it("single mode: spawns subagent, captures final assistant text, returns it", async () => {
		const mockSpawn = (() =>
			fakeChild([
				JSON.stringify({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "hello from subagent" }],
					},
				}),
			])) as any;

		const tool = createTaskToolDefinition(process.cwd(), {
			caveBin: "cave",
			mockSpawn,
			loader: () => stubLoaded,
		});

		const result = await tool.execute("call-1", { agent: "tester", task: "say hi" }, undefined, undefined, {} as any);

		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("fullOutputPath:");
		expect(text).toContain("hello from subagent");
		expect(result.details?.mode).toBe("single");
		expect(result.details?.results).toHaveLength(1);
		expect(result.details?.results[0]?.exitCode).toBe(0);
	});

	it("rejects unknown agent with available list", async () => {
		const tool = createTaskToolDefinition(process.cwd(), {
			caveBin: "cave",
			mockSpawn: (() => fakeChild([], 1)) as any,
			loader: () => stubLoaded,
		});

		const result = await tool.execute("call-2", { agent: "nonexistent", task: "x" }, undefined, undefined, {} as any);

		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("Subagent failed");
		expect(text).toContain("Unknown agent");
		expect(text).toContain("tester");
	});
});

// ── Background subagent lifecycle (issue #17 HIGH 1) ────────────────────────
//
// A background subagent spawns a detached, `unref()`'d child plus a
// `createWriteStream` for its JSONL output. Without honoring the parent's
// AbortSignal, aborting/disposing the parent left an uncancellable orphan
// process and a leaked file descriptor. These tests assert the abort path
// terminates the child (SIGTERM → SIGKILL) and closes the stream.

/** A long-running fake child that records the signals it receives and never exits. */
function fakeBackgroundChild(): {
	child: any;
	killSignals: string[];
} {
	const killSignals: string[] = [];
	const child = new EventEmitter() as any;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.killed = false;
	child.unref = () => {};
	child.kill = (sig?: string) => {
		killSignals.push(sig ?? "SIGTERM");
		if (sig === "SIGKILL" || sig === undefined || sig === "SIGTERM") child.killed = true;
		return true;
	};
	return { child, killSignals };
}

const backgroundLoaded: LoadAgentDefsResult = {
	agents: [
		{
			def: {
				name: "bg-tester",
				description: "Background test agent",
				prompt: "You are a background tester.",
				tools: ["read"],
				model: undefined,
				isolation: "none",
				background: true,
				source: "user",
				filePath: "<test:bg-tester>",
			},
			sourceInfo: {
				path: "<test:bg-tester>",
				metadata: { source: "synthetic", scope: "user", origin: "synthetic" },
			} as any,
		},
	],
	diagnostics: [],
};

describe("Task tool — background subagent abort (issue #17)", () => {
	afterEach(() => {
		_resetRegistry();
	});

	it("terminates the background child with SIGTERM when the parent signal aborts", async () => {
		const { child, killSignals } = fakeBackgroundChild();
		const controller = new AbortController();

		const tool = createTaskToolDefinition(process.cwd(), {
			caveBin: "cave",
			mockSpawn: (() => child) as any,
			loader: () => backgroundLoaded,
		});

		const result = await tool.execute(
			"call-bg-1",
			{ agent: "bg-tester", task: "long task" },
			controller.signal,
			undefined,
			{} as any,
		);

		expect(result.details?.mode).toBe("async_launched");
		const agentId = result.details?.asyncLaunches?.[0]?.agentId;
		expect(agentId).toBeTruthy();

		// No signal yet — the detached child is still running.
		expect(killSignals).toEqual([]);

		// Aborting the parent must reach the spawned child.
		controller.abort();
		expect(killSignals).toContain("SIGTERM");
	});

	it("closes the output write stream so the file descriptor is released on abort", async () => {
		const { child } = fakeBackgroundChild();
		const controller = new AbortController();

		const tool = createTaskToolDefinition(process.cwd(), {
			caveBin: "cave",
			mockSpawn: (() => child) as any,
			loader: () => backgroundLoaded,
		});

		const result = await tool.execute(
			"call-bg-2",
			{ agent: "bg-tester", task: "long task" },
			controller.signal,
			undefined,
			{} as any,
		);
		const agentId = result.details?.asyncLaunches?.[0]?.agentId as string;

		// The registry entry holds the live child until it exits.
		expect(getBackground(agentId)?.status).toBe("running");

		controller.abort();
		// Child honors SIGTERM and exits; the close handler cancels escalation and
		// ends the stream, flipping status away from `running`.
		child.killed = true;
		child.emit("close", 143);
		await new Promise((r) => setImmediate(r));

		const entry = getBackground(agentId);
		expect(entry?.status).not.toBe("running");
		expect(entry?.child).toBeUndefined();
	});

	// W4 — the abort listener is registered with `{ once: true }`, which only
	// auto-removes when abort FIRES. On the common normal-exit path (child closes
	// without any abort), the `close` handler must explicitly remove the listener,
	// otherwise it lingers on the signal forever holding closures over
	// `child`/`out`/`escalation` — the exact leak class #17 fixes.
	it("removes the abort listener from the signal when the child exits normally (no abort)", async () => {
		const { child, killSignals } = fakeBackgroundChild();
		const controller = new AbortController();

		// Instrument the signal to count live "abort" listeners. We cannot read
		// EventTarget listener counts directly, so wrap add/removeEventListener.
		let abortListeners = 0;
		const signal = controller.signal;
		const origAdd = signal.addEventListener.bind(signal);
		const origRemove = signal.removeEventListener.bind(signal);
		signal.addEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === "abort") abortListeners++;
			return (origAdd as any)(type, ...rest);
		}) as typeof signal.addEventListener;
		signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === "abort") abortListeners--;
			return (origRemove as any)(type, ...rest);
		}) as typeof signal.removeEventListener;

		const tool = createTaskToolDefinition(process.cwd(), {
			caveBin: "cave",
			mockSpawn: (() => child) as any,
			loader: () => backgroundLoaded,
		});

		await tool.execute("call-bg-3", { agent: "bg-tester", task: "short task" }, signal, undefined, {} as any);

		// One abort listener registered; nothing aborted yet.
		expect(abortListeners).toBe(1);

		// Child exits on its own (normal completion) — no abort ever fires.
		child.emit("close", 0);
		await new Promise((r) => setImmediate(r));

		// The `close` handler must have removed the listener. If it didn't, the
		// closure (and the child/stream it captures) leaks for the signal's life.
		expect(abortListeners).toBe(0);
		// And we never tried to kill a normally-exiting child.
		expect(killSignals).toEqual([]);
	});
});
