/**
 * #185 — agents view v2: spawn agents as independent detached processes.
 *
 * The daemon-based spawn + ensureDaemon auto-start were retired (agents view v2,
 * Phase B2). spawnAgent now launches a detached `mewrite -p` process; here we
 * cover the no-op-on-empty-task contract and that a real task launches (returns
 * true and writes a log file under the agent dir) without throwing.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setKeybindings } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { spawnAgent } from "../../../src/cli/agents.js";
import { getAgentDir } from "../../../src/config.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";

describe("#185 spawnAgent (detached process)", () => {
	beforeAll(() => setKeybindings(KeybindingsManager.create()));

	it("no-ops on an empty task (returns null, launches nothing)", () => {
		expect(spawnAgent("/tmp", "   ")).toBeNull();
	});

	it("launches a detached agent for a real task and writes a log file", () => {
		const logDir = join(getAgentDir(), "agent-logs");
		const before = new Set(safeReaddir(logDir));
		// Spawn in /tmp so the child (if it starts) does no work in the repo. The child
		// is detached + unref'd; it may exit immediately (no key) but must not throw here.
		// spawnAgent returns the child pid (number) on launch, null on no-op.
		const launched = spawnAgent("/tmp", "noop task for test");
		expect(typeof launched).toBe("number");
		const after = safeReaddir(logDir);
		// A new per-run log file was created for the spawned agent's output.
		expect(after.some((f) => !before.has(f) && f.endsWith(".log"))).toBe(true);
	});
});

function safeReaddir(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}
