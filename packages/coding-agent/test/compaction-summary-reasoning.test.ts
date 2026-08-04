import type { AgentMessage } from "@zhachory1/mewrite-agent";
import type { AssistantMessage, AssistantMessageEvent, Model } from "@zhachory1/mewrite-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSummary } from "../src/core/compaction/index.js";

const { streamSimpleMock } = vi.hoisted(() => ({
	streamSimpleMock: vi.fn(),
}));

vi.mock("@zhachory1/mewrite-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@zhachory1/mewrite-ai")>();
	return {
		...actual,
		streamSimple: streamSimpleMock,
	};
});

function createModel(reasoning: boolean): Model<"anthropic-messages"> {
	return {
		id: reasoning ? "reasoning-model" : "non-reasoning-model",
		name: reasoning ? "Reasoning Model" : "Non-reasoning Model",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	};
}

const mockSummaryResponse: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "## Goal\nTest summary" }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	usage: {
		input: 10,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 20,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
};

/**
 * Minimal stand-in for AssistantMessageEventStream: async-iterable over the
 * provided events plus a result() promise, mirroring the real EventStream
 * contract that completeSummaryWithIdleTimeout relies on. `gapMs` inserts a
 * delay before the FIRST event to simulate a slow/stalled provider.
 */
function fakeStream(events: AssistantMessageEvent[], result: AssistantMessage, opts: { gapMs?: number } = {}) {
	return {
		async *[Symbol.asyncIterator]() {
			if (opts.gapMs) await new Promise((r) => setTimeout(r, opts.gapMs));
			for (const ev of events) yield ev;
		},
		result: async () => result,
	};
}

const startEvent = { type: "start", partial: mockSummaryResponse } as unknown as AssistantMessageEvent;

const messages: AgentMessage[] = [{ role: "user", content: "Summarize this.", timestamp: Date.now() }];

describe("generateSummary reasoning options", () => {
	beforeEach(() => {
		streamSimpleMock.mockReset();
		streamSimpleMock.mockReturnValue(fakeStream([startEvent], mockSummaryResponse));
	});
	afterEach(() => {
		delete process.env.CAVE_COMPACTION_IDLE_TIMEOUT_MS;
	});

	it("sets reasoning=high for reasoning-capable models", async () => {
		await generateSummary(messages, createModel(true), 2000, "test-key");

		expect(streamSimpleMock).toHaveBeenCalledTimes(1);
		expect(streamSimpleMock.mock.calls[0][2]).toMatchObject({
			reasoning: "high",
			apiKey: "test-key",
		});
	});

	it("does not set reasoning for non-reasoning models", async () => {
		await generateSummary(messages, createModel(false), 2000, "test-key");

		expect(streamSimpleMock).toHaveBeenCalledTimes(1);
		expect(streamSimpleMock.mock.calls[0][2]).toMatchObject({ apiKey: "test-key" });
		expect(streamSimpleMock.mock.calls[0][2]).not.toHaveProperty("reasoning");
	});

	it("returns the summary text from the streamed result", async () => {
		const text = await generateSummary(messages, createModel(false), 2000, "test-key");
		expect(text).toContain("Test summary");
	});

	it("does NOT kill a slow-but-progressing summary (idle resets per event)", async () => {
		process.env.CAVE_COMPACTION_IDLE_TIMEOUT_MS = "50";
		// First event arrives after 30ms (< 50ms idle window) then completes.
		streamSimpleMock.mockReturnValue(fakeStream([startEvent], mockSummaryResponse, { gapMs: 30 }));
		const text = await generateSummary(messages, createModel(false), 2000, "test-key");
		expect(text).toContain("Test summary");
	});

	it("aborts and throws when the stream stalls past the idle window", async () => {
		process.env.CAVE_COMPACTION_IDLE_TIMEOUT_MS = "20";
		// No event for 200ms >> 20ms idle window -> watchdog fires.
		streamSimpleMock.mockReturnValue(fakeStream([startEvent], mockSummaryResponse, { gapMs: 200 }));
		await expect(generateSummary(messages, createModel(false), 2000, "test-key")).rejects.toThrow(/stalled/i);
	});
});
