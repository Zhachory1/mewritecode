/**
 * #185 phase C+ — cross-process steering inbox for spawned agents.
 *
 * A `mewrite agents`-spawned agent runs as an independent process. To catch a
 * runaway (an agent working on the wrong thing) before it finishes, the agents
 * view writes redirect messages to the agent's inbox file; the agent's own
 * process watches that file and injects each message into its steering queue at
 * the next turn boundary (mid-stream) or as a fresh prompt (when idle).
 *
 * This is deliberately a file channel (no sockets): the write side is the agents
 * view, the read side is the spawned agent, and they agree on the path purely
 * from the session id. Interrupt is handled separately by signalling the pid.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../config.js";

// fs.watchFile polls by mtime; a shorter interval makes a redirect land faster
// (up to this long from the write) and keeps rapid successive writes from being
// coalesced into one poll. 100ms is responsive for interactive steering without
// meaningfully busy-polling.
const INBOX_POLL_INTERVAL_MS = 100;

/** Minimal steering surface the watcher needs from an AgentSession. */
interface SteerableSession {
	readonly isStreaming: boolean;
	prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
}

/** Deterministic inbox path for a session id, agreed by writer and reader. */
export function agentInboxPath(sessionId: string): string {
	return join(getAgentDir(), "agent-inbox", `${sessionId}.jsonl`);
}

/** Append a steering message to an agent's inbox (writer side, agents view). */
export function sendAgentSteer(sessionId: string, message: string): void {
	const path = agentInboxPath(sessionId);
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	appendFileSync(path, `${JSON.stringify({ ts: Date.now(), message })}\n`, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Start watching this process's inbox and inject new messages into the session's
 * steering queue. Reader side, runs inside the spawned agent. Returns a disposer.
 * Best-effort: never throws; a malformed line is skipped.
 */
export function startInboxSteer(session: SteerableSession, sessionId: string): () => void {
	const path = agentInboxPath(sessionId);
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	// Only deliver lines appended after we start, so a resumed session doesn't
	// replay old redirects. Seed the cursor at the current byte length.
	let cursor = existsSync(path) ? readFileSync(path, "utf-8").length : 0;

	const deliver = (raw: string): void => {
		const line = raw.trim();
		if (!line) return;
		let message: string | undefined;
		try {
			const parsed = JSON.parse(line) as { message?: unknown };
			if (typeof parsed.message === "string") message = parsed.message;
		} catch {
			return;
		}
		if (!message) return;
		// Mid-stream -> steer (applied at the next turn boundary); idle -> a fresh
		// prompt. Both are the same mechanism the interactive UI uses.
		const opts = session.isStreaming ? { streamingBehavior: "steer" as const } : undefined;
		void session.prompt(message, opts).catch(() => {});
	};

	const drain = (): void => {
		let content: string;
		try {
			content = readFileSync(path, "utf-8");
		} catch {
			return;
		}
		if (content.length <= cursor) {
			// Truncated/rotated: reset the cursor so we don't miss the new tail.
			if (content.length < cursor) cursor = 0;
			return;
		}
		const fresh = content.slice(cursor);
		cursor = content.length;
		for (const raw of fresh.split("\n")) deliver(raw);
	};

	const listener = (): void => drain();
	watchFile(path, { interval: INBOX_POLL_INTERVAL_MS }, listener);
	return () => unwatchFile(path, listener);
}
