/**
 * WS17: CheckpointManager — high-level facade wiring snapshotter + index + lock.
 *
 * One instance per project session. The manager:
 *  1. Derives a stable repo hash from the project root absolute path.
 *  2. Owns the shadow dir at ~/.cave/checkpoints/<hash>/.
 *  3. Serializes snapshots within a session via a file-based lock.
 *  4. Exposes `preToolSnapshot(tool, sessionId)` for write/edit/bash hooks.
 *  5. Exposes `manualSnapshot(name, sessionId)` for /checkpoint.
 *  6. Exposes `rollback(steps, opts)` and `list()` for the CLI.
 *
 * The lock file is ~/.cave/checkpoints/<hash>/lock.  If another process holds
 * it we time-out after 5s and warn rather than deadlock.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CheckpointIndex } from "./index-file.js";
import {
	rollback as doRollback,
	type RollbackListEntry,
	type RollbackOptions,
	type RollbackResult,
	rollbackList,
} from "./rollback.js";
import { isMutatingTool } from "./shadow-git.js";
import { type SnapshotReason, type SnapshotResult, Snapshotter } from "./snapshotter.js";

/** Derive a 16-char hex hash from the project root absolute path. */
export function repoHash(projectRoot: string): string {
	return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}

/** Where the shadow repo and index live for a given project. */
export function shadowDirFor(projectRoot: string, home = homedir(), configDirName = ".cave"): string {
	return join(home, configDirName, "checkpoints", repoHash(projectRoot));
}

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 50;

async function acquireLock(lockFile: string): Promise<() => void> {
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			// O_EXCL is atomic — only one process wins
			const fd = openSync(lockFile, "wx");
			writeFileSync(lockFile, `${process.pid}`, "utf-8");
			closeSync(fd);
			return () => {
				try {
					unlinkSync(lockFile);
				} catch {
					// already removed
				}
			};
		} catch {
			// Lock held; wait and retry
			await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
		}
	}
	// Timed out — check if PID is still alive; if not, steal the lock
	try {
		const stalePid = Number(readFileSync(lockFile, "utf-8"));
		if (!isProcessAlive(stalePid)) {
			unlinkSync(lockFile);
			return acquireLock(lockFile);
		}
	} catch {
		// ignore
	}
	// Give up with a no-op release
	console.warn(`[cave/checkpoints] Lock timeout after ${LOCK_TIMEOUT_MS}ms; proceeding without lock`);
	return () => {};
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export class CheckpointManager {
	private readonly shadowDir: string;
	private readonly lockFile: string;
	private readonly snapshotter: Snapshotter;
	private readonly index: CheckpointIndex;

	constructor(
		readonly projectRoot: string,
		home = homedir(),
		configDirName = ".cave",
	) {
		this.shadowDir = shadowDirFor(projectRoot, home, configDirName);
		const shadowGitDir = join(this.shadowDir, ".git");

		if (!existsSync(this.shadowDir)) {
			mkdirSync(this.shadowDir, { recursive: true });
		}

		this.lockFile = join(this.shadowDir, "lock");
		this.snapshotter = new Snapshotter(shadowGitDir, projectRoot);
		this.index = new CheckpointIndex(this.shadowDir, projectRoot);
	}

	/**
	 * Called before a destructive tool executes.
	 * Skips silently for non-mutating tools.
	 */
	async preToolSnapshot(tool: string, sessionId: string): Promise<SnapshotResult | null> {
		if (!isMutatingTool(tool)) return null;

		const reason = toolToReason(tool);
		return this.takeSnapshot(reason, sessionId);
	}

	/** Called by /checkpoint <name> slash command. */
	async manualSnapshot(name: string, sessionId: string): Promise<SnapshotResult> {
		const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
		return this.takeSnapshot(`manual:${safeName}`, sessionId);
	}

	private async takeSnapshot(reason: SnapshotReason, sessionId: string): Promise<SnapshotResult> {
		const release = await acquireLock(this.lockFile);
		try {
			const result = await this.snapshotter.snapshot(reason, sessionId);
			this.index.push({
				ts: new Date().toISOString(),
				sessionId,
				reason,
				files: result.files,
				commit: result.commit,
			});
			return result;
		} finally {
			release();
		}
	}

	/**
	 * Roll back N steps. Acquires lock to prevent concurrent snapshots
	 * interfering with the restore.
	 */
	async rollback(steps: number, options: RollbackOptions = {}): Promise<RollbackResult> {
		const release = await acquireLock(this.lockFile);
		try {
			return doRollback(steps, this.index, this.snapshotter, options);
		} finally {
			release();
		}
	}

	/** Return last 20 checkpoints for display. */
	list(limit = 20): RollbackListEntry[] {
		return rollbackList(this.index, limit);
	}

	/** Expose index for tests / introspection. */
	getIndex(): CheckpointIndex {
		return this.index;
	}

	/** Expose snapshotter for tests. */
	getSnapshotter(): Snapshotter {
		return this.snapshotter;
	}
}

function toolToReason(tool: string): SnapshotReason {
	switch (tool) {
		case "write":
			return "pre-write";
		case "edit":
		case "edit_symbol":
		case "apply_sr_diff":
			return "pre-edit";
		case "bash":
			return "pre-bash";
		default:
			return "pre-edit";
	}
}
