/**
 * In-process registry for background subagent runs.
 *
 * The Task tool spawns the cave child detached and returns immediately with a
 * stable agentId. The child's stdout JSONL is tee'd to
 * `~/.cave/tasks/{agentId}/output.jsonl`. The parent (or the
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
import { existsSync, mkdirSync } from "node:fs";
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

export function getTasksDir(): string {
	const dir = join(getAgentDir(), "tasks");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function getTaskOutputPath(agentId: string): string {
	const dir = join(getTasksDir(), agentId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "output.jsonl");
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
}
