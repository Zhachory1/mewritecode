/**
 * #158 / #168 — opt-in debug logging for the agents/daemon path.
 *
 * Enable by setting MEWRITE_AGENTS_DEBUG:
 * - `1` or `true`: log all events to ~/.mewrite/agent/agents-debug.log
 * - absolute path: log all events to that path
 * - comma-separated tags (e.g. `runner,daemon`): log only those categories to default path
 * - comma-separated tags with path (e.g. `runner,ws=/tmp/debug.log`): log those categories to that path
 *
 * Writes newline-delimited timestamped events from BOTH the daemon process and the client
 * process, so they interleave in one file and you can see the full request/stream lifecycle.
 * Best-effort; never throws. Automatically rotates when file exceeds 50 MiB (keeps one .1 backup).
 */

import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Max size before rotation. Exported for test override via MEWRITE_AGENTS_DEBUG_MAXBYTES. */
export const DEFAULT_DEBUG_LOG_MAX_BYTES = 50 * 1024 * 1024;

let cachedPath: string | null | undefined;
let cachedAllowlist: Set<string> | null | undefined;
let lastRotationCheck = 0;
let writesSinceCheck = 0;

interface ParsedDebugConfig {
	path: string;
	allowlist: Set<string> | null; // null = all allowed
}

function parseDebugEnv(env: string): ParsedDebugConfig | null {
	// Back-compat: `1` or `true` => log all to default path
	if (env === "1" || env === "true") {
		return {
			path: join(homedir(), ".mewrite", "agent", "agents-debug.log"),
			allowlist: null,
		};
	}

	// Back-compat: absolute path => log all to that path
	if (env.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(env)) {
		return { path: env, allowlist: null };
	}

	// Category filtering: comma-separated tags, optional =path suffix
	const knownTags = ["runner", "daemon", "pane", "serve"];
	let path = join(homedir(), ".mewrite", "agent", "agents-debug.log");
	const allowlist = new Set<string>();

	for (const part of env.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		const eqIdx = trimmed.indexOf("=");
		if (eqIdx !== -1) {
			const tag = trimmed.slice(0, eqIdx).trim();
			const customPath = trimmed.slice(eqIdx + 1).trim();
			if (tag && knownTags.includes(tag)) allowlist.add(tag);
			if (customPath) path = customPath;
		} else if (knownTags.includes(trimmed)) {
			allowlist.add(trimmed);
		}
	}

	if (allowlist.size === 0) return null; // no valid tags
	return { path, allowlist };
}

function resolvePath(): string | null {
	if (cachedPath !== undefined) return cachedPath;
	const env = process.env.MEWRITE_AGENTS_DEBUG;
	if (!env) {
		cachedPath = null;
		cachedAllowlist = null;
		return null;
	}
	const parsed = parseDebugEnv(env);
	if (!parsed) {
		cachedPath = null;
		cachedAllowlist = null;
		return null;
	}
	cachedPath = parsed.path;
	cachedAllowlist = parsed.allowlist;
	return cachedPath;
}

function dlogAllows(who: string): boolean {
	// Ensure cache is populated by calling resolvePath
	if (resolvePath() === null) return false;
	// After resolvePath, cachedAllowlist is defined (either null or Set)
	// null or undefined allowlist = all allowed
	if (!cachedAllowlist) return true;
	// otherwise check the allowlist
	return cachedAllowlist.has(who);
}

export function dlogEnabled(): boolean {
	return resolvePath() !== null;
}

/** Reset cached state (for tests only). */
export function resetDebugLogForTest(): void {
	cachedPath = undefined;
	cachedAllowlist = undefined;
	lastRotationCheck = 0;
	writesSinceCheck = 0;
}

function getMaxBytes(): number {
	const envMax = process.env.MEWRITE_AGENTS_DEBUG_MAXBYTES;
	return envMax ? Number.parseInt(envMax, 10) : DEFAULT_DEBUG_LOG_MAX_BYTES;
}

function maybeRotate(path: string): void {
	const now = Date.now();
	writesSinceCheck++;
	// Throttle: only check every 50 writes or every 2s
	if (writesSinceCheck < 50 && now - lastRotationCheck < 2000) return;
	lastRotationCheck = now;
	writesSinceCheck = 0;

	try {
		if (!existsSync(path)) return;
		const stats = statSync(path);
		if (stats.size < getMaxBytes()) return;
		// Rotate: rename current to .1 (overwrite old .1)
		const backup = `${path}.1`;
		renameSync(path, backup);
	} catch {
		/* best-effort */
	}
}

/** Log a debug event. `who` is a short tag (e.g. "daemon", "runner", "pane"). */
export function dlog(who: string, event: string, data?: Record<string, unknown>): void {
	const path = resolvePath();
	if (!path) return;
	if (!dlogAllows(who)) return;
	try {
		maybeRotate(path);
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
