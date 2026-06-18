/**
 * CAVE_TRACE — opt-in JSONL trace sink for the agent loop (#19).
 *
 * The agent loop emits a clean {@link AgentSessionEvent} taxonomy but ships no
 * tracing of its own. When the `CAVE_TRACE` environment variable is set, we
 * attach a passive listener to the existing session event stream and append one
 * JSONL line per salient event: lifecycle, turn timing, and token deltas.
 *
 * Design constraints:
 * - **Pure serialization.** {@link formatTraceLine} is a pure function of an
 *   event plus a small mutable accumulator ({@link TraceState}). It returns a
 *   JSON string to append, or `null` to skip noise. It is fully unit-tested
 *   without touching the filesystem or the event bus.
 * - **Thin I/O wrapper.** {@link createTraceSink} owns the file handle and the
 *   append, delegating all formatting to {@link formatTraceLine}.
 * - **Passive.** The sink never mutates events and never throws into the loop;
 *   it is just another subscriber. Default OFF means zero subscription and zero
 *   overhead.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentEvent, AgentMessage } from "@zhachory1/mewrite-agent";
import type { AgentSessionEvent } from "./agent-session.js";

/**
 * Mutable accumulator threaded through {@link formatTraceLine} across the event
 * stream. Carries the open-turn wall-clock start (for `turnDurationMs`) and the
 * cumulative token total seen so far (for `tokenDelta`).
 */
export interface TraceState {
	/** Wall-clock ms at the most recent `turn_start`, or undefined when no turn is open. */
	turnStartedAt?: number;
	/** Cumulative `totalTokens` observed across assistant messages so far. */
	cumulativeTokens: number;
}

/** Create a fresh trace accumulator. */
export function createTraceState(): TraceState {
	return { cumulativeTokens: 0 };
}

/** Narrow an AgentMessage to its token-usage total, if it carries one. */
function usageTotal(message: AgentMessage | undefined): number | undefined {
	if (!message || typeof message !== "object") return undefined;
	const usage = (message as { usage?: { totalTokens?: number } }).usage;
	if (!usage || typeof usage.totalTokens !== "number") return undefined;
	return usage.totalTokens;
}

/** Best-effort message role for the trace line, when the event carries a message. */
function messageRole(message: AgentMessage | undefined): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	return (message as { role?: string }).role;
}

/**
 * Pure serializer: map a session event to a single JSONL line, or `null` to
 * skip. Mutates `state` for turn timing and token-delta accounting only.
 *
 * Emitted fields:
 * - `ts` — wall-clock ms when the line is produced (caller-injected via `now`).
 * - `type` — the event type.
 * - salient per-type fields (tool name, message role, error flags, …).
 * - `turnDurationMs` — on `turn_end`, wall-clock since the matching `turn_start`.
 * - `tokenDelta` — on events carrying assistant usage, the increase in
 *   cumulative `totalTokens` since the previous usage-bearing event.
 *
 * Skipped (returns `null`): high-frequency streaming noise
 * (`message_update`, `tool_execution_update`) that would flood the log without
 * adding signal for loop debugging.
 */
export function formatTraceLine(event: AgentSessionEvent, state: TraceState, now: number = Date.now()): string | null {
	const line: Record<string, unknown> = { ts: now, type: event.type };

	switch (event.type) {
		// --- streaming noise: skip ---
		case "message_update":
		case "tool_execution_update":
			return null;

		// --- turn timing ---
		case "turn_start":
			state.turnStartedAt = now;
			break;
		case "turn_end": {
			if (state.turnStartedAt !== undefined) {
				line.turnDurationMs = now - state.turnStartedAt;
				state.turnStartedAt = undefined;
			}
			line.role = messageRole(event.message);
			line.toolResultCount = event.toolResults.length;
			applyTokenDelta(line, state, usageTotal(event.message));
			break;
		}

		// --- message lifecycle ---
		case "message_start":
		case "message_end": {
			line.role = messageRole(event.message);
			applyTokenDelta(line, state, usageTotal(event.message));
			break;
		}

		// --- tool execution ---
		case "tool_execution_start":
			line.toolName = event.toolName;
			line.toolCallId = event.toolCallId;
			break;
		case "tool_execution_end":
			line.toolName = event.toolName;
			line.toolCallId = event.toolCallId;
			line.isError = event.isError;
			break;

		// --- agent lifecycle ---
		case "agent_start":
			break;
		case "agent_end":
			line.messageCount = event.messages.length;
			break;

		// --- checkpoints / subagents ---
		case "checkpoint_taken":
			line.checkpointId = event.checkpointId;
			line.toolName = event.toolName;
			line.fileCount = event.fileCount;
			break;
		case "subagent_progress":
			line.subagentName = event.subagentName;
			line.phase = event.phase;
			if (event.detail) line.detail = event.detail;
			break;

		// --- session-level events ---
		case "compaction_start":
			line.reason = event.reason;
			break;
		case "compaction_end":
			line.reason = event.reason;
			line.aborted = event.aborted;
			line.willRetry = event.willRetry;
			break;
		case "auto_retry_start":
			line.attempt = event.attempt;
			line.maxAttempts = event.maxAttempts;
			line.delayMs = event.delayMs;
			break;
		case "auto_retry_end":
			line.success = event.success;
			line.attempt = event.attempt;
			break;
		case "queue_update":
			line.steering = event.steering.length;
			line.followUp = event.followUp.length;
			break;

		default: {
			// Exhaustiveness guard: if a new AgentEvent variant is added, this keeps
			// the trace from silently emitting bare {ts,type} with no context. We
			// still emit the line so the event is at least recorded.
			const _exhaustive: never = event as never;
			void _exhaustive;
			break;
		}
	}

	return JSON.stringify(line);
}

/** Record a token delta on `line` when `total` advances the cumulative count. */
function applyTokenDelta(line: Record<string, unknown>, state: TraceState, total: number | undefined): void {
	if (total === undefined) return;
	const delta = total - state.cumulativeTokens;
	// Only emit a delta when usage actually advanced. A repeated total (e.g. the
	// same assistant message seen at message_start and turn_end) yields delta 0,
	// which we skip to avoid implying fresh token spend.
	if (delta > 0) {
		line.tokenDelta = delta;
		state.cumulativeTokens = total;
	}
}

/** Subscriber signature accepted by {@link createTraceSink}. */
export type TraceSubscribe = (listener: (event: AgentSessionEvent) => void) => () => void;

/** Resolve the trace output path from a `CAVE_TRACE` value. */
export function resolveTracePath(value: string, sessionId: string, now: number = Date.now()): string {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "1" || trimmed.toLowerCase() === "true") {
		return join(homedir(), ".cave", "trace", `${sessionId}-${now}.jsonl`);
	}
	return trimmed;
}

/** Minimal filesystem surface the sink needs; injectable for tests. */
export interface TraceFs {
	mkdirSync: (path: string, opts: { recursive: true }) => void;
	appendFileSync: (path: string, data: string) => void;
}

const nodeFs: TraceFs = {
	mkdirSync: (path, opts) => {
		mkdirSync(path, opts);
	},
	appendFileSync: (path, data) => {
		appendFileSync(path, data);
	},
};

/**
 * Attach a passive JSONL trace sink to a session's event stream, gated on
 * `CAVE_TRACE`. Returns an unsubscribe function, or `undefined` when tracing is
 * off — so callers can assert that nothing was subscribed.
 *
 * The sink swallows its own I/O errors: a broken trace file must never break the
 * agent loop.
 */
export function createTraceSink(opts: {
	envValue: string | undefined;
	sessionId: string;
	subscribe: TraceSubscribe;
	fs?: TraceFs;
	now?: () => number;
}): (() => void) | undefined {
	const { envValue, sessionId, subscribe } = opts;
	if (envValue === undefined) return undefined;

	const fs = opts.fs ?? nodeFs;
	const now = opts.now ?? Date.now;
	const path = resolveTracePath(envValue, sessionId, now());
	const state = createTraceState();

	let dirReady = false;
	const ensureDir = (): void => {
		if (dirReady) return;
		try {
			fs.mkdirSync(dirname(path), { recursive: true });
		} catch {
			// best-effort; appendFileSync will surface a hard failure below
		}
		dirReady = true;
	};

	return subscribe((event: AgentSessionEvent) => {
		try {
			const formatted = formatTraceLine(event, state, now());
			if (formatted === null) return;
			ensureDir();
			fs.appendFileSync(path, `${formatted}\n`);
		} catch {
			// Passive sink: never propagate trace failures into the loop.
		}
	});
}

/** Re-exported for callers that want the raw event union. */
export type { AgentEvent };
