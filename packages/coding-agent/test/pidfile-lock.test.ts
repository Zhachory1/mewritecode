/**
 * Unit tests for pidfile lock acquisition (issue #167). Imports the real helper
 * from its own module (not serve.ts, which has CLI side effects) so the tests
 * cannot drift from the implementation.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { acquirePidfileLock } from "../src/core/daemon/pidfile-lock.js";

describe("acquirePidfileLock", () => {
	let testDir: string;
	let pidFile: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `pidfile-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		pidFile = join(testDir, "daemon.pid");
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	test("acquires lock when no pidfile exists", () => {
		const result = acquirePidfileLock(pidFile);
		expect(result).toEqual({ ok: true });
		expect(existsSync(pidFile)).toBe(true);
		expect(readFileSync(pidFile, "utf8").trim()).toBe(String(process.pid));
	});

	test("refuses lock when pidfile names a live process", () => {
		// Write our own pid to simulate another live daemon
		writeFileSync(pidFile, String(process.pid), "utf8");

		const result = acquirePidfileLock(pidFile);
		expect(result).toEqual({ ok: false, reason: "peer-alive", pid: process.pid });
	});

	test("reclaims stale pidfile (dead pid)", () => {
		// Write a huge dead pid (2^31 - 1 should not exist)
		const deadPid = 2 ** 31 - 1;
		writeFileSync(pidFile, String(deadPid), "utf8");

		const result = acquirePidfileLock(pidFile);
		expect(result).toEqual({ ok: true });
		expect(readFileSync(pidFile, "utf8").trim()).toBe(String(process.pid));
	});

	test("reclaims corrupt pidfile (non-numeric)", () => {
		writeFileSync(pidFile, "not-a-number", "utf8");

		const result = acquirePidfileLock(pidFile);
		expect(result).toEqual({ ok: true });
		expect(readFileSync(pidFile, "utf8").trim()).toBe(String(process.pid));
	});

	test("writes our pid on successful acquisition", () => {
		const result = acquirePidfileLock(pidFile);
		expect(result.ok).toBe(true);

		const writtenPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
		expect(writtenPid).toBe(process.pid);
	});
});
