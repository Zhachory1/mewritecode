/**
 * #167 — atomic single-daemon pidfile lock.
 *
 * Prevents two `mewrite serve` processes from racing the port. Acquisition uses
 * O_EXCL (`openSync(path, "wx")`), which is an atomic test-and-create at the
 * syscall level (POSIX) — no time-of-check/time-of-use gap. A pidfile owned by a
 * live process means a peer daemon already runs; a corrupt or dead-owner pidfile is
 * stale and reclaimed. All fs faults are captured, and every fd is closed even on a
 * failed write, so this never throws and never leaks a descriptor.
 */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** True if a process with this pid exists (signal 0 probe). */
export function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but is owned by another user (alive).
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Atomically create the pidfile with our pid using O_EXCL, closing the fd even if
 * the write fails (no fd leak). Returns "created" on success, "exists" if another
 * process already holds it (EEXIST), or "error" for anything else. Never throws.
 */
function tryCreatePidfile(pidFile: string): "created" | "exists" | "error" {
	let fd: number | undefined;
	try {
		fd = openSync(pidFile, "wx"); // O_EXCL: atomic test-and-create (POSIX), no TOCTOU
		writeFileSync(fd, String(process.pid), "utf8");
		return "created";
	} catch (err: unknown) {
		return (err as NodeJS.ErrnoException).code === "EEXIST" ? "exists" : "error";
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				/* already closed / best-effort */
			}
		}
	}
}

export type PidfileLockResult = { ok: true } | { ok: false; reason: "peer-alive" | "error"; pid?: number };

/**
 * Atomically acquire the pidfile lock. On success the pidfile contains our pid and
 * is held for the process lifetime (remove it on exit). Handles stale/corrupt
 * pidfile reclamation. Never throws.
 */
export function acquirePidfileLock(pidFile: string): PidfileLockResult {
	try {
		mkdirSync(dirname(pidFile), { recursive: true });
	} catch {
		return { ok: false, reason: "error" };
	}

	const first = tryCreatePidfile(pidFile);
	if (first === "created") return { ok: true };
	if (first === "error") return { ok: false, reason: "error" };

	// Pidfile exists. Read the owning pid to decide: live peer vs stale/corrupt.
	let existingPid: number;
	try {
		existingPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
	} catch {
		return { ok: false, reason: "error" };
	}

	// A corrupt (NaN) pidfile or one owned by a dead process is stale: reclaim it
	// and retry the exclusive create exactly once.
	const stale = Number.isNaN(existingPid) || !processAlive(existingPid);
	if (!stale) return { ok: false, reason: "peer-alive", pid: existingPid };

	try {
		rmSync(pidFile, { force: true });
	} catch {
		return { ok: false, reason: "error" };
	}
	return tryCreatePidfile(pidFile) === "created" ? { ok: true } : { ok: false, reason: "error" };
}
