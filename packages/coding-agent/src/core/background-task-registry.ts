/**
 * In-process registry for background subagent runs.
 *
 * The Task tool spawns the cave child detached and returns immediately with a
 * stable agentId. The child's stdout JSONL is tee'd to
 * `~/.mewrite/agent/tasks/{agentId}/output.jsonl` (via getAgentDir). The parent
 * (or the
 * `send_message`/`task_status` tools) reads from this registry to learn:
 *   - whether the run is still running,
 *   - the absolute path of the output file,
 *   - the optional addressable name (for `send_message --to <name>`),
 *   - a mailbox of inbound messages awaiting delivery.
 *
 * The registry is per-process — a parent that exits drops it. Persistence is
 * not required: the on-disk output file outlives the registry, and the
 * `task_status` tool can rebuild a minimal entry by stat'ing it.
 */

import type { ChildProcess } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	opendirSync,
	readdirSync,
	renameSync,
	rm,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

export type BackgroundStatus = "running" | "completed" | "failed";

export interface BackgroundSubagent {
	agentId: string;
	/** User-supplied addressable handle (`task({name: ...})`) — optional. */
	name?: string;
	subagentName: string;
	task: string;
	startedAt: number;
	finishedAt?: number;
	exitCode?: number;
	status: BackgroundStatus;
	outputFile: string;
	/** Inbound mailbox. SendMessage drains this on the next steering poll. */
	mailbox: string[];
	child?: ChildProcess;
}

const _registry = new Map<string, BackgroundSubagent>();
const _byName = new Map<string, string>(); // name → agentId
const ACTIVE_MARKER_PREFIX = ".active-";
const PRUNE_DIR_PREFIX = ".prune-";
const MAX_TASK_ARTIFACT_DIRS = 500;
const MAX_TASK_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TASK_ARTIFACT_SCAN = 600;
const MAX_TASK_ARTIFACTS_PER_PRUNE = 25;
const MAX_TASK_PRUNE_BYTES = 512 * 1024 * 1024;
const ACTIVE_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let activeMarkerCounter = 0;
let pruneCounter = 0;
let pruneImmediate: NodeJS.Immediate | undefined;
let initialPruneDone = false;

export function getTasksDir(): string {
	const dir = join(getAgentDir(), "tasks");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function taskDirIsActive(dir: string): boolean {
	for (const name of readdirSync(dir)) {
		if (!name.startsWith(ACTIVE_MARKER_PREFIX)) continue;
		const marker = join(dir, name);
		const pid = Number.parseInt(name.slice(ACTIVE_MARKER_PREFIX.length), 10);
		try {
			if (Date.now() - statSync(marker).mtimeMs > ACTIVE_MARKER_MAX_AGE_MS) throw new Error("stale marker");
			if (!Number.isFinite(pid) || pid <= 0) throw new Error("invalid pid");
			process.kill(pid, 0);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
			rmSync(marker, { force: true });
		}
	}
	return false;
}

function pruneTaskArtifactsUnchecked(synchronous = false): boolean {
	const tasksDir = getTasksDir();
	const entries: Array<{ name: string }> = [];
	const dir = opendirSync(tasksDir);
	let scanTruncated = false;
	try {
		for (let scanned = 0; scanned < MAX_TASK_ARTIFACT_SCAN * 2; scanned++) {
			const entry = dir.readSync();
			if (!entry) break;
			if (!entry.isDirectory() || (entry.name.startsWith(".") && !entry.name.startsWith(PRUNE_DIR_PREFIX))) continue;
			if (entries.length === MAX_TASK_ARTIFACT_SCAN) {
				scanTruncated = true;
				break;
			}
			entries.push({ name: entry.name });
		}
	} finally {
		dir.closeSync();
	}
	const artifacts = entries
		.flatMap((entry) => {
			try {
				const dir = join(tasksDir, entry.name);
				const files = readdirSync(dir, { withFileTypes: true });
				const size = files.reduce((total, file) => {
					if (!file.isFile() || file.name.startsWith(ACTIVE_MARKER_PREFIX)) return total;
					try {
						return total + statSync(join(dir, file.name)).size;
					} catch {
						return total;
					}
				}, 0);
				const pruneDir = entry.name.startsWith(PRUNE_DIR_PREFIX);
				return [{ dir, size, mtimeMs: statSync(dir).mtimeMs, active: !pruneDir && taskDirIsActive(dir), pruneDir }];
			} catch {
				return [];
			}
		})
		.sort((a, b) => Number(b.pruneDir) - Number(a.pruneDir) || a.mtimeMs - b.mtimeMs);
	let totalBytes = artifacts.reduce((total, artifact) => total + artifact.size, 0);
	const visibleDirs = artifacts.filter((artifact) => !artifact.pruneDir).length;
	let totalDirs = scanTruncated ? MAX_TASK_ARTIFACT_DIRS + MAX_TASK_ARTIFACTS_PER_PRUNE : visibleDirs;
	let deletedBytes = 0;
	let deletedDirs = 0;
	for (const artifact of artifacts) {
		if (
			!artifact.pruneDir &&
			!synchronous &&
			totalBytes <= MAX_TASK_ARTIFACT_BYTES &&
			totalDirs <= MAX_TASK_ARTIFACT_DIRS
		) {
			break;
		}
		if (artifact.active) continue;
		if (deletedDirs >= MAX_TASK_ARTIFACTS_PER_PRUNE) break;
		if (deletedBytes > 0 && deletedBytes + artifact.size > MAX_TASK_PRUNE_BYTES) break;
		try {
			if (synchronous) {
				rmSync(artifact.dir, { recursive: true, force: true });
				return true;
			}
			if (artifact.pruneDir) {
				rm(artifact.dir, { recursive: true, force: true }, () => {});
			} else {
				const pruneDir = join(tasksDir, `${PRUNE_DIR_PREFIX}${process.pid}-${++pruneCounter}`);
				renameSync(artifact.dir, pruneDir);
				rm(pruneDir, { recursive: true, force: true }, () => {});
				totalDirs--;
			}
			totalBytes -= artifact.size;
			deletedBytes += artifact.size;
			deletedDirs++;
		} catch {}
	}
	return deletedDirs > 0;
}

export function pruneTaskArtifacts(): boolean {
	try {
		return pruneTaskArtifactsUnchecked();
	} catch {
		return false;
	}
}

function scheduleTaskArtifactPrune(): void {
	if (pruneImmediate) return;
	pruneImmediate = setImmediate(() => {
		pruneImmediate = undefined;
		if (pruneTaskArtifacts()) scheduleTaskArtifactPrune();
	});
	pruneImmediate.unref?.();
}

export function markTaskActive(agentId: string, pid = process.pid): void {
	const tasksDir = getTasksDir();
	const dir = join(tasksDir, agentId);
	const markerName = `${ACTIVE_MARKER_PREFIX}${pid}`;
	if (!existsSync(dir)) {
		const stagingDir = join(tasksDir, `.${agentId}-${process.pid}-${++activeMarkerCounter}`);
		try {
			mkdirSync(stagingDir);
			writeFileSync(join(stagingDir, markerName), "", { mode: 0o600 });
			renameSync(stagingDir, dir);
			return;
		} catch (error) {
			rmSync(stagingDir, { recursive: true, force: true });
			if (!existsSync(dir)) throw error;
		}
	}
	const marker = join(dir, markerName);
	if (existsSync(marker)) {
		const now = new Date();
		utimesSync(marker, now, now);
	} else {
		writeFileSync(marker, "", { flag: "wx", mode: 0o600 });
	}
}

export function getTaskOutputPath(agentId: string, active = false): string {
	const dir = join(getTasksDir(), agentId);
	if (!initialPruneDone) {
		scheduleTaskArtifactPrune();
		initialPruneDone = true;
	}
	const create = () => {
		if (active) markTaskActive(agentId);
		else if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	};
	try {
		create();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOSPC" && code !== "EDQUOT") throw error;
		pruneTaskArtifactsUnchecked(true);
		create();
	}
	return join(dir, "output.jsonl");
}

export function markTaskFinished(agentId: string): void {
	try {
		const dir = join(getTasksDir(), agentId);
		for (const name of readdirSync(dir)) {
			if (name.startsWith(ACTIVE_MARKER_PREFIX)) rmSync(join(dir, name), { force: true });
		}
	} catch {}
	scheduleTaskArtifactPrune();
}

export function registerBackground(entry: BackgroundSubagent): void {
	_registry.set(entry.agentId, entry);
	if (entry.name) _byName.set(entry.name, entry.agentId);
}

export function updateBackground(agentId: string, patch: Partial<BackgroundSubagent>): void {
	const existing = _registry.get(agentId);
	if (!existing) return;
	Object.assign(existing, patch);
}

export function getBackground(idOrName: string): BackgroundSubagent | undefined {
	return _registry.get(idOrName) ?? _registry.get(_byName.get(idOrName) ?? "");
}

export function listBackground(): BackgroundSubagent[] {
	return [..._registry.values()];
}

export function postMessage(idOrName: string, message: string): boolean {
	const entry = getBackground(idOrName);
	if (!entry) return false;
	if (entry.status !== "running") return false;
	entry.mailbox.push(message);
	return true;
}

export function drainMailbox(agentId: string): string[] {
	const entry = _registry.get(agentId);
	if (!entry || entry.mailbox.length === 0) return [];
	const drained = entry.mailbox.slice();
	entry.mailbox = [];
	return drained;
}

/** Test helper. */
export function _resetRegistry(): void {
	_registry.clear();
	_byName.clear();
	activeMarkerCounter = 0;
	pruneCounter = 0;
	if (pruneImmediate) clearImmediate(pruneImmediate);
	pruneImmediate = undefined;
	initialPruneDone = false;
}
