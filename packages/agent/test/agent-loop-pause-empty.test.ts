/**
 * Regression for issue #142 ("agent sometimes just stops").
 *
 * Two clean-stop silent-halt paths in the agent loop:
 *
 * 1. pause_turn: Anthropic maps `pause_turn` -> StopReason "pause" (previously
 *    mislabeled "stop"). A "pause" turn must re-stream so the model continues,
 *    not end the turn. Bounded so a persistently-pausing provider can't spin.
 *
 * 2. empty response: a clean stop with no tool calls and no content is a
 *    provider glitch, not a completion. The loop retries once, then ends
 *    normally (so the empty message is at least visible).
 */
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@zhachory1/mewrite-ai";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.js";
import type { AgentContext, AgentEvent, AgentMessage } from "../src/types.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

async function drain(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

const baseContext = (): AgentContext => ({ systemPrompt: "sys", messages: [], tools: [] });

describe("agent loop: pause_turn handling", () => {
	it("re-streams on a 'pause' turn instead of stopping, then completes", async () => {
		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message = createAssistantMessage([{ type: "text", text: "working" }], "pause");
					stream.push({ type: "done", reason: "pause", message });
				} else {
					const message = createAssistantMessage([{ type: "text", text: "final answer" }], "stop");
					stream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return stream;
		};

		const events = await drain(
			agentLoop(
				[createUserMessage("hi")],
				baseContext(),
				{ model: createModel(), convertToLlm: identityConverter },
				undefined,
				streamFn,
			),
		);

		// The loop continued past the pause: provider called twice.
		expect(callIndex).toBe(2);
		// The final, non-paused message is present.
		const ended = events.find((e) => e.type === "agent_end");
		expect(ended).toBeDefined();
		if (ended?.type === "agent_end") {
			const texts = ended.messages
				.filter((m): m is AssistantMessage => m.role === "assistant")
				.flatMap((m) => m.content)
				.filter((c) => c.type === "text")
				.map((c) => (c as { text: string }).text);
			expect(texts).toContain("final answer");
		}
	});

	it("gives up after the pause cap instead of looping forever", async () => {
		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				callIndex++;
				const message = createAssistantMessage([{ type: "text", text: "still paused" }], "pause");
				stream.push({ type: "done", reason: "pause", message });
			});
			return stream;
		};

		const events = await drain(
			agentLoop(
				[createUserMessage("hi")],
				baseContext(),
				{ model: createModel(), convertToLlm: identityConverter },
				undefined,
				streamFn,
			),
		);

		// Bounded: MAX_CONSECUTIVE_PAUSES (10) + the initial pass, not unbounded.
		expect(callIndex).toBeLessThanOrEqual(11);
		expect(callIndex).toBeGreaterThan(1);
		expect(events.some((e) => e.type === "agent_end")).toBe(true);
	});
});

describe("agent loop: empty-response guard", () => {
	it("retries a content-free assistant turn once, then completes", async () => {
		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message = createAssistantMessage([], "stop"); // empty
					stream.push({ type: "done", reason: "stop", message });
				} else {
					const message = createAssistantMessage([{ type: "text", text: "recovered" }], "stop");
					stream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return stream;
		};

		const events = await drain(
			agentLoop(
				[createUserMessage("hi")],
				baseContext(),
				{ model: createModel(), convertToLlm: identityConverter },
				undefined,
				streamFn,
			),
		);

		expect(callIndex).toBe(2); // retried once
		const ended = events.find((e) => e.type === "agent_end");
		expect(ended).toBeDefined();
	});

	it("does not retry a normal non-empty turn", async () => {
		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				callIndex++;
				const message = createAssistantMessage([{ type: "text", text: "hello" }], "stop");
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		await drain(
			agentLoop(
				[createUserMessage("hi")],
				baseContext(),
				{ model: createModel(), convertToLlm: identityConverter },
				undefined,
				streamFn,
			),
		);

		expect(callIndex).toBe(1);
	});
});
