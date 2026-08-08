/**
 * #158 — opt-in debug logging for the agents/daemon path.
 *
 * Enable by setting MEWRITE_AGENTS_DEBUG=1 (or a path). Writes newline-delimited
 * timestamped events to ~/.mewrite/agent/agents-debug.log (or the given path), from
 * BOTH the daemon process and the client process, so the two interleave in one file
 * and you can see the full request/stream lifecycle. Best-effort; never throws.
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let cachedPath: string | null | undefined;

function resolvePath(): string | null {
	if (cachedPath !== undefined) return cachedPath;
	const env = process.env.MEWRITE_AGENTS_DEBUG;
	if (!env) {
		cachedPath = null;
		return null;
	}
	cachedPath = env === "1" || env === "true" ? join(homedir(), ".mewrite", "agent", "agents-debug.log") : env;
	return cachedPath;
}

export function dlogEnabled(): boolean {
	return resolvePath() !== null;
}

/** Log a debug event. `who` is a short tag (e.g. "daemon", "runner", "pane"). */
export function dlog(who: string, event: string, data?: Record<string, unknown>): void {
	const path = resolvePath();
	if (!path) return;
	try {
		const ts = new Date().toISOString();
		const pid = process.pid;
		const extra = data ? ` ${safeJson(data)}` : "";
		appendFileSync(path, `${ts} [${who}:${pid}] ${event}${extra}\n`);
	} catch {
		/* best-effort */
	}
}

function safeJson(data: Record<string, unknown>): string {
	try {
		return JSON.stringify(data, (_k, v) => {
			if (typeof v === "string" && v.length > 200) return `${v.slice(0, 200)}…(${v.length})`;
			return v;
		});
	} catch {
		return "<unserializable>";
	}
}
