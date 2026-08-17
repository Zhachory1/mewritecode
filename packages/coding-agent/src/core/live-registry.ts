/**
 * #152 phase 2 — interactive session liveness registry.
 *
 * Each interactive `mewrite` session self-publishes a tiny liveness file so a
 * separate `mewrite agents` process can list it alongside daemon sessions,
 * without any daemon dependency or event relay. The file carries only
 * {id, pid, cwd, state} — no transcript content.
 *
 * Design (see DD-phase2): writes are async + atomic (temp + rename), best-effort
 * (an fs error never throws into the agent loop), and the file is unlinked on
 * clean shutdown. `mewrite agents` reaps stale files (dead pid / stale mtime).
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "../config.js";
import type { AgentSession } from "./agent-session.js";

const REFRESH_MS = 5000;
/** A live file older than this (by mtime) is treated as stale and reaped. */
const STALE_MS = 15000;

export interface LiveRecord {
	id: string;
	pid: number;
	cwd: string;
	state: "running" | "idle";
	updatedAt: string;
	/** Display title: explicit session name, else derived from the first user message. */
	title?: string;
}

/** Max visible length of a derived title before truncation. */
const DERIVED_TITLE_MAX_CHARS = 60;
const DERIVED_TITLE_MAX_WORDS = 6;

/**
 * Derive a concise display title for a session (#174): an explicit name (set via
 * `/name`) wins; otherwise the first user message, first line only, clamped to a
 * few words. Returns undefined when there is nothing to derive from (the agents
 * view then falls back to cwd/id as before).
 */
export function deriveSessionTitle(session: AgentSession): string | undefined {
	try {
		return deriveSessionTitleUnsafe(session);
	} catch {
		// Best-effort like the rest of the registry: a title must never throw into
		// the agent loop or the heartbeat.
		return undefined;
	}
}

function deriveSessionTitleUnsafe(session: AgentSession): string | undefined {
	const explicit = session.sessionName?.trim();
	if (explicit) return explicit;
	for (const message of session.state.messages) {
		if ((message as { role?: string }).role !== "user") continue;
		const content = (message as { content?: unknown }).content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter((b): b is { type: "text"; text: string } => (b as { type?: string })?.type === "text")
							.map((b) => b.text)
							.join(" ")
					: "";
		const firstLine = text.trim().split("\n")[0]?.trim();
		if (!firstLine) continue;
		const words = firstLine.split(/\s+/).slice(0, DERIVED_TITLE_MAX_WORDS).join(" ");
		return words.length > DERIVED_TITLE_MAX_CHARS ? `${words.slice(0, DERIVED_TITLE_MAX_CHARS - 1)}…` : words;
	}
	return undefined;
}

export function getLiveDir(): string {
	return join(getAgentDir(), "live");
}

function liveFilePath(id: string): string {
	return join(getLiveDir(), `${id}.json`);
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but is owned by another user (alive).
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Best-effort atomic write of a liveness record. Never throws.
 */
async function writeRecord(rec: LiveRecord): Promise<void> {
	try {
		await mkdir(getLiveDir(), { recursive: true, mode: 0o700 });
		const path = liveFilePath(rec.id);
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(rec), { mode: 0o600 });
		await rename(tmp, path);
	} catch {
		/* best-effort: fs failure must not affect the agent loop */
	}
}

/**
 * Remove this user's stale live files (dead pid) at startup so a prior `kill -9`
 * does not leave records on disk indefinitely. Best-effort.
 */
async function sweepDeadFiles(): Promise<void> {
	try {
		const dir = getLiveDir();
		if (!existsSync(dir)) return;
		const entries = await readdir(dir);
		await Promise.all(
			entries
				.filter((f) => f.endsWith(".json"))
				.map(async (f) => {
					try {
						const raw = await readFile(join(dir, f), "utf8");
						const rec = JSON.parse(raw) as LiveRecord;
						if (typeof rec.pid === "number" && !pidAlive(rec.pid)) {
							await unlink(join(dir, f));
						}
					} catch {
						/* skip unreadable/torn file */
					}
				}),
		);
	} catch {
		/* best-effort */
	}
}

/**
 * Read live interactive sessions, reaping any whose owning process is dead or
 * whose file is stale (mtime older than STALE_MS) or unparseable. Best-effort:
 * a read failure yields an empty list rather than throwing.
 */
export async function listLiveInteractive(now: number = Date.now()): Promise<LiveRecord[]> {
	const dir = getLiveDir();
	if (!existsSync(dir)) return [];
	let entries: string[];
	try {
		entries = (await readdir(dir)).filter((f) => f.endsWith(".json"));
	} catch {
		return [];
	}
	const out: LiveRecord[] = [];
	await Promise.all(
		entries.map(async (f) => {
			const path = join(dir, f);
			try {
				const st = await stat(path);
				const raw = await readFile(path, "utf8");
				const rec = JSON.parse(raw) as LiveRecord;
				const fresh = now - st.mtimeMs < STALE_MS;
				if (typeof rec.pid === "number" && pidAlive(rec.pid) && fresh) {
					out.push(rec);
				} else {
					await unlink(path).catch(() => {});
				}
			} catch {
				// Torn/unreadable file: reap it.
				await unlink(path).catch(() => {});
			}
		}),
	);
	return out;
}

/**
 * Publish liveness for an interactive session. Returns a dispose function that
 * stops refreshing and removes the file. Safe to call the dispose more than once.
 */
export function attachLiveRegistry(session: AgentSession, cwd: string): () => void {
	if (process.env.MEWRITE_NO_LIVE) return () => {};

	const id = session.sessionId;
	let disposed = false;

	const record = (): LiveRecord => ({
		id,
		pid: process.pid,
		cwd,
		state: session.isStreaming ? "running" : "idle",
		updatedAt: new Date().toISOString(),
		// Best-effort: recomputed on each write (state transitions + heartbeat), so
		// the title appears once the first user message exists and tracks /name.
		title: deriveSessionTitle(session),
	});

	void sweepDeadFiles().then(() => {
		if (!disposed) void writeRecord(record());
	});

	// Rewrite on streaming-state transitions only (not per token).
	let lastState = session.isStreaming;
	const unsubscribe = session.subscribe(() => {
		if (disposed) return;
		const now = session.isStreaming;
		if (now !== lastState) {
			lastState = now;
			void writeRecord(record());
		}
	});

	// Low-frequency heartbeat so a long-idle-but-alive session stays fresh.
	const timer = setInterval(() => {
		if (!disposed) void writeRecord(record());
	}, REFRESH_MS);
	timer.unref?.();

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		clearInterval(timer);
		unsubscribe();
		void unlink(liveFilePath(id)).catch(() => {});
	};

	const onExit = (): void => dispose();
	process.once("exit", onExit);
	process.once("SIGINT", onExit);
	process.once("SIGTERM", onExit);

	return () => {
		process.removeListener("exit", onExit);
		process.removeListener("SIGINT", onExit);
		process.removeListener("SIGTERM", onExit);
		dispose();
	};
}
