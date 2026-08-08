/**
 * Unit tests for pidfile lock acquisition (issue #167).
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// Inline acquirePidfileLock for testing without importing serve.ts
function dirname(p: string): string {
	return p.split("/").slice(0, -1).join("/") || "/";
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function acquirePidfileLock(
	pidFile: string,
): { ok: true } | { ok: false; reason: "peer-alive" | "error"; pid?: number } {
	mkdirSync(dirname(pidFile), { recursive: true });

	// Try to atomically create the pidfile with O_EXCL
	try {
		const fd = openSync(pidFile, "wx");
		writeFileSync(fd, String(process.pid), "utf8");
		closeSync(fd);
		return { ok: true };
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
			// Unexpected error (permissions, etc.)
			return { ok: false, reason: "error" };
		}

		// Pidfile exists; check if the process is alive
		let existingPid: number;
		try {
			existingPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
			if (Number.isNaN(existingPid)) {
				// Corrupt pidfile; treat as stale
				rmSync(pidFile, { force: true });
				// Retry once
				try {
					const fd = openSync(pidFile, "wx");
					writeFileSync(fd, String(process.pid), "utf8");
					closeSync(fd);
					return { ok: true };
				} catch {
					// Another process won during retry
					return { ok: false, reason: "error" };
				}
			}
		} catch {
			// Cannot read pidfile
			return { ok: false, reason: "error" };
		}

		if (processAlive(existingPid)) {
			// A live daemon holds the lock
			return { ok: false, reason: "peer-alive", pid: existingPid };
		}

		// Stale pidfile; reclaim
		try {
			rmSync(pidFile, { force: true });
			const fd = openSync(pidFile, "wx");
			writeFileSync(fd, String(process.pid), "utf8");
			closeSync(fd);
			return { ok: true };
		} catch {
			// Another process won during reclaim
			return { ok: false, reason: "error" };
		}
	}
}

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
