/**
 * WS9 Daemon — default agent-runner factory.
 *
 * For P0 we ship a tokenizing echo runner: it stores the user message,
 * streams a deterministic acknowledgement back word-by-word, persists the
 * assistant message, then signals `done`. This lets `caveman serve` boot
 * immediately and exercises the full streaming path without dragging the
 * full agent runtime through `caveman serve`'s startup.
 *
 * TODO(ws9-real-runner): swap in a factory that delegates to
 * `createAgentSession()` from sdk.ts, wiring the agent's event bus to the
 * RunnerEmitter. WS6 (subagents) and WS7 (memory) need the runtime hookup,
 * so we hold the full integration until those land. Until then, the daemon
 * is functionally a multi-client transport with persistent transcripts —
 * exactly the v2.1 cut-line described in the master plan's risk register.
 */

import { randomUUID } from "node:crypto";
import type { MessageRecord, SessionRecord } from "./protocol.js";
import type { AgentRunner, RunnerEmitter, RunnerFactory } from "./server.js";

export interface DefaultRunnerOptions {
	/** Tokens emitted per second when streaming the echo. Default 200. */
	tokensPerSecond?: number;
	/** Custom reply factory for tests. Default: echoes the user's text. */
	reply?: (text: string, session: SessionRecord) => string;
}

export function createDefaultRunnerFactory(opts: DefaultRunnerOptions = {}): RunnerFactory {
	const tps = Math.max(1, opts.tokensPerSecond ?? 200);
	const intervalMs = Math.max(1, Math.floor(1000 / tps));
	const replyFn = opts.reply ?? defaultReply;

	return (session: SessionRecord, emit: RunnerEmitter): AgentRunner => {
		let interrupted = false;
		let active = false;

		async function streamReply(text: string): Promise<MessageRecord> {
			const reply = replyFn(text, session);
			const tokens = tokenize(reply);
			active = true;
			interrupted = false;
			emit({ type: "state", sessionId: session.id, state: "running" });
			const assistantMsg: MessageRecord = {
				id: `m_${randomUUID()}`,
				sessionId: session.id,
				role: "assistant",
				text: reply,
				createdAt: new Date().toISOString(),
			};
			for (const tok of tokens) {
				if (interrupted) break;
				emit({ type: "token", sessionId: session.id, text: tok, role: "assistant" });
				await sleep(intervalMs);
			}
			// Persist the full assistant message after stream completion.
			emit({ type: "message", message: assistantMsg });
			emit({ type: "state", sessionId: session.id, state: "idle" });
			emit({ type: "done", sessionId: session.id });
			active = false;
			return assistantMsg;
		}

		return {
			async send(text: string): Promise<MessageRecord> {
				const userMsg: MessageRecord = {
					id: `m_${randomUUID()}`,
					sessionId: session.id,
					role: "user",
					text,
					createdAt: new Date().toISOString(),
				};
				emit({ type: "message", message: userMsg });
				// Don't await: stream proceeds asynchronously so the HTTP POST
				// returns 202 quickly and the WS receives tokens in real time.
				void streamReply(text).catch((err) => {
					emit({ type: "state", sessionId: session.id, state: "error" });
					emit({ type: "done", sessionId: session.id });
					console.error("[caveman serve] runner failure:", err);
				});
				return userMsg;
			},
			interrupt(): void {
				if (active) interrupted = true;
			},
			close(): void {
				interrupted = true;
			},
		};
	};
}

function tokenize(text: string): string[] {
	// Stream by whitespace-preserving chunks — small enough that WS coalescing
	// in server.ts gets a chance to batch multiple tokens per tick.
	const out: string[] = [];
	const re = /\s+|\S+/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
	while ((m = re.exec(text)) !== null) out.push(m[0]);
	return out;
}

function defaultReply(text: string, session: SessionRecord): string {
	return `[cave:${session.id.slice(0, 8)}] ack: ${text}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
