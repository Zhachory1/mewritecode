/**
 * Regression for issue #142 ("agent sometimes just stops").
 *
 * Root cause: the per-request output budget was a flat `Math.min(model.maxTokens, 32000)`
 * clamp. This throttled large-output models (64k/128k) down to 32k, so long
 * replies / big tool calls hit the cap, returned stopReason "length", and the
 * agent loop ended the turn silently.
 *
 * `resolveMaxOutputTokens` replaces that clamp: the model's own maxTokens is the
 * ceiling, and when a context + contextWindow are known it additionally caps so
 * input + output fits the window (a hard API requirement for Anthropic, Bedrock,
 * Gemini), never dropping below a small floor.
 */

import { describe, expect, it } from "vitest";
import { estimateContextTokens, resolveMaxOutputTokens } from "../src/providers/simple-options.js";
import type { Api, Context, Model } from "../src/types.js";

function model(partial: Partial<Model<Api>>): Model<Api> {
	return {
		id: "test",
		api: "anthropic-messages" as Api,
		provider: "test",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		contextWindow: 200000,
		maxTokens: 64000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		name: "test",
		...partial,
	} as Model<Api>;
}

function ctx(text: string): Context {
	return { messages: [{ role: "user", content: text, timestamp: 0 }] };
}

describe("resolveMaxOutputTokens", () => {
	it("returns the model's full ceiling for a large-output model with light context (the #142 fix)", () => {
		// Previously clamped to 32000; now the model's real 64000 budget is available.
		const out = resolveMaxOutputTokens(model({ maxTokens: 64000, contextWindow: 200000 }), ctx("hello"));
		expect(out).toBe(64000);
	});

	it("falls back to the model ceiling when no context is provided", () => {
		expect(resolveMaxOutputTokens(model({ maxTokens: 128000 }), undefined)).toBe(128000);
	});

	it("shrinks the budget so input + output fits the context window", () => {
		// contextWindow 10000, maxTokens 8000, with a big input → output must be < 8000.
		const big = "x".repeat(4 * 5000); // ~5000 input tokens
		const out = resolveMaxOutputTokens(model({ maxTokens: 8000, contextWindow: 10000 }), ctx(big));
		expect(out).toBeLessThan(8000);
		expect(out).toBeGreaterThan(0);
	});

	it("bounds junk catalog entries where maxTokens == contextWindow", () => {
		// Such entries would request the whole window as output → guaranteed API 400.
		const out = resolveMaxOutputTokens(model({ maxTokens: 200000, contextWindow: 200000 }), ctx("hi"));
		expect(out).toBeLessThan(200000);
	});

	it("never drops below the minimum output floor even when context is full", () => {
		const huge = "x".repeat(4 * 50000); // ~50000 input tokens, far exceeds a tiny window
		const out = resolveMaxOutputTokens(model({ maxTokens: 8000, contextWindow: 8000 }), ctx(huge));
		expect(out).toBeGreaterThanOrEqual(1024);
	});

	it("never exceeds the model ceiling even with a huge window and empty context", () => {
		const out = resolveMaxOutputTokens(model({ maxTokens: 8192, contextWindow: 1000000 }), ctx(""));
		expect(out).toBe(8192);
	});
});

describe("estimateContextTokens", () => {
	it("scales with input size", () => {
		const small = estimateContextTokens(ctx("hi"));
		const large = estimateContextTokens(ctx("x".repeat(4000)));
		expect(large).toBeGreaterThan(small);
	});

	it("counts the system prompt", () => {
		const withSystem: Context = { systemPrompt: "x".repeat(400), messages: [] };
		expect(estimateContextTokens(withSystem)).toBeGreaterThan(0);
	});
});
