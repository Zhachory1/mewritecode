// #19 — CAVE_TRACE opt-in JSONL trace sink: pure serialization + thin fs sink.

import type { AgentMessage } from "@zhachory1/mewrite-agent";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../agent-session.js";
import { createTraceSink, createTraceState, formatTraceLine, resolveTracePath, type TraceFs } from "../trace.js";

function assistant(totalTokens: number): AgentMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		stopReason: "stop",
		timestamp: 0,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} as AgentMessage;
}

describe("formatTraceLine", () => {
	it("records turn duration between turn_start and turn_end", () => {
		const state = createTraceState();
		expect(formatTraceLine({ type: "turn_start" }, state, 1_000)).toBe(
			JSON.stringify({ ts: 1_000, type: "turn_start" }),
		);

		const line = formatTraceLine({ type: "turn_end", message: assistant(0), toolResults: [] }, state, 1_350);
		const parsed = JSON.parse(line as string);
		expect(parsed.type).toBe("turn_end");
		expect(parsed.turnDurationMs).toBe(350);
		expect(parsed.role).toBe("assistant");
		expect(parsed.toolResultCount).toBe(0);
	});

	it("emits a token delta as cumulative usage advances", () => {
		const state = createTraceState();
		const first = JSON.parse(formatTraceLine({ type: "message_end", message: assistant(120) }, state, 1) as string);
		expect(first.tokenDelta).toBe(120);

		const second = JSON.parse(formatTraceLine({ type: "message_end", message: assistant(200) }, state, 2) as string);
		expect(second.tokenDelta).toBe(80);
	});

	it("omits tokenDelta when usage has not advanced", () => {
		const state = createTraceState();
		formatTraceLine({ type: "message_start", message: assistant(50) }, state, 1);
		// Same message seen again at turn_end -> no fresh spend.
		const line = JSON.parse(
			formatTraceLine({ type: "turn_end", message: assistant(50), toolResults: [] }, state, 2) as string,
		);
		expect(line.tokenDelta).toBeUndefined();
	});

	it("captures tool execution start/end with name and error flag", () => {
		const state = createTraceState();
		const start = JSON.parse(
			formatTraceLine(
				{ type: "tool_execution_start", toolCallId: "tc1", toolName: "bash", args: {}, startedAt: 0 },
				state,
				1,
			) as string,
		);
		expect(start).toMatchObject({ type: "tool_execution_start", toolName: "bash", toolCallId: "tc1" });

		const end = JSON.parse(
			formatTraceLine(
				{ type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", result: {}, isError: true },
				state,
				2,
			) as string,
		);
		expect(end).toMatchObject({ type: "tool_execution_end", toolName: "bash", isError: true });
	});

	it("skips high-frequency streaming noise", () => {
		const state = createTraceState();
		expect(
			formatTraceLine(
				{ type: "message_update", message: assistant(0), assistantMessageEvent: {} as never },
				state,
				1,
			),
		).toBeNull();
		expect(
			formatTraceLine(
				{ type: "tool_execution_update", toolCallId: "x", toolName: "bash", args: {}, partialResult: {} },
				state,
				1,
			),
		).toBeNull();
	});

	it("records agent_end message count", () => {
		const state = createTraceState();
		const line = JSON.parse(
			formatTraceLine({ type: "agent_end", messages: [assistant(0), assistant(0)] }, state, 1) as string,
		);
		expect(line.messageCount).toBe(2);
	});
});

describe("resolveTracePath", () => {
	it("uses a default ~/.cave path for '1'", () => {
		const path = resolveTracePath("1", "sess-abc", 42);
		expect(path).toMatch(/\.cave\/trace\/sess-abc-42\.jsonl$/);
	});

	it("uses an explicit file path verbatim", () => {
		expect(resolveTracePath("/tmp/my-trace.jsonl", "s", 0)).toBe("/tmp/my-trace.jsonl");
	});
});

describe("createTraceSink", () => {
	function fakeFs(): { fs: TraceFs; appended: Array<[string, string]> } {
		const appended: Array<[string, string]> = [];
		const fs: TraceFs = {
			mkdirSync: () => undefined,
			appendFileSync: (p, d) => {
				appended.push([p, d]);
			},
		};
		return { fs, appended };
	}

	it("does not subscribe when CAVE_TRACE is unset", () => {
		const subscribe = vi.fn(() => () => undefined);
		const unsub = createTraceSink({
			envValue: undefined,
			sessionId: "s",
			subscribe,
		});
		expect(unsub).toBeUndefined();
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("subscribes and appends JSONL lines when CAVE_TRACE is set", () => {
		const { fs, appended } = fakeFs();
		let captured: ((e: AgentSessionEvent) => void) | undefined;
		const subscribe = vi.fn((listener: (e: AgentSessionEvent) => void) => {
			captured = listener;
			return () => undefined;
		});

		const unsub = createTraceSink({
			envValue: "/tmp/trace.jsonl",
			sessionId: "s",
			subscribe,
			fs,
			now: () => 7,
		});

		expect(unsub).toBeInstanceOf(Function);
		expect(subscribe).toHaveBeenCalledOnce();
		expect(captured).toBeDefined();

		captured?.({ type: "turn_start" });
		captured?.({ type: "tool_execution_start", toolCallId: "t", toolName: "read", args: {}, startedAt: 0 });

		expect(appended).toHaveLength(2);
		expect(appended[0][0]).toBe("/tmp/trace.jsonl");
		const first = JSON.parse(appended[0][1].trimEnd());
		expect(first).toEqual({ ts: 7, type: "turn_start" });
		expect(appended[0][1].endsWith("\n")).toBe(true);
	});

	it("writes nothing for skipped (noise) events", () => {
		const { fs, appended } = fakeFs();
		let captured: ((e: AgentSessionEvent) => void) | undefined;
		const subscribe = (listener: (e: AgentSessionEvent) => void) => {
			captured = listener;
			return () => undefined;
		};

		createTraceSink({ envValue: "1", sessionId: "s", subscribe, fs, now: () => 1 });
		captured?.({ type: "message_update", message: assistant(0), assistantMessageEvent: {} as never });
		expect(appended).toHaveLength(0);
	});

	it("swallows fs errors so tracing never breaks the loop", () => {
		let captured: ((e: AgentSessionEvent) => void) | undefined;
		const fs: TraceFs = {
			mkdirSync: () => undefined,
			appendFileSync: () => {
				throw new Error("disk full");
			},
		};
		createTraceSink({
			envValue: "1",
			sessionId: "s",
			subscribe: (l) => {
				captured = l;
				return () => undefined;
			},
			fs,
		});
		expect(() => captured?.({ type: "turn_start" })).not.toThrow();
	});
});
