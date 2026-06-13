/**
 * Savings Meter (DD §10) — AgentSession capture integration tests.
 *
 * Drives the wired `afterToolCall` hook directly (dedup early-return vs the net
 * cave pipeline), the soft-compaction path is covered via the tracker unit
 * tests, and verifies the derived-on-read cache-reuse fold over the message
 * list (idempotent, per-message model pricing, separate from the caveman total).
 */

import { Agent } from "@juliusbrussee/caveman-agent";
import { type AssistantMessage, getModel, type Usage } from "@juliusbrussee/caveman-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

const model = getModel("anthropic", "claude-sonnet-4-5")!; // input 3, cacheRead 0.3 → Δ 2.7
const haiku = getModel("anthropic", "claude-haiku-4-5")!; // input 1, cacheRead 0.1 → Δ 0.9

function createSession(opts?: { cave?: boolean }) {
	const settingsManager = SettingsManager.inMemory();
	if (opts?.cave) {
		settingsManager.setCaveModeEnabled(true);
		settingsManager.setCaveModeToolCompression(true);
	}
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRegistry: ModelRegistry.inMemory(authStorage),
		resourceLoader: createTestResourceLoader(),
	});
	return { session, sessionManager };
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

/** Build a minimal afterToolCall context; unused fields are cast loosely. */
function afterToolCallCtx(opts: { name: string; args: unknown; text: string; isError?: boolean }) {
	return {
		assistantMessage: { content: [] } as never,
		toolCall: { type: "toolCall", id: "tc", name: opts.name, arguments: {} },
		args: opts.args,
		result: textResult(opts.text),
		isError: opts.isError ?? false,
		context: {} as never,
	} as Parameters<NonNullable<AgentSession["agent"]["afterToolCall"]>>[0];
}

function assistantWithCacheRead(modelId: string, cacheRead: number, timestamp: number): AssistantMessage {
	const usage: Usage = {
		input: 100,
		output: 50,
		cacheRead,
		cacheWrite: 0,
		totalTokens: 150 + cacheRead,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: model.api,
		provider: model.provider,
		model: modelId,
		usage,
		stopReason: "stop",
		timestamp,
	};
}

describe("AgentSession savings capture (DD §10)", () => {
	it("records compression net delta + denominator for a non-dedup result", async () => {
		const { session } = createSession({ cave: true });
		try {
			// Many consecutive blank lines collapse → deterministic compression.
			const before = `line1\n\n\n\n\n\n\n\n\n\nline2`;
			await session.agent.afterToolCall!(
				afterToolCallCtx({ name: "bash", args: { command: "echo" }, text: before }),
			);
			const totals = session.getSavings();
			expect(totals.totalToolOutputBytes).toBe(before.length);
			expect(totals.bySource.compression.bytes).toBeGreaterThan(0);
			expect(totals.bytesSaved).toBe(totals.bySource.compression.bytes);
			// Honest denominator: saved / total.
			expect(totals.percentCompressed).toBeCloseTo(totals.bytesSaved / before.length, 12);
		} finally {
			session.dispose();
		}
	});

	it("dedup short-circuits: books re-read-avoided bytes, disjoint from compression", async () => {
		const { session } = createSession({ cave: true });
		try {
			const content = "the quick brown fox jumps over the lazy dog ".repeat(20);
			const call = () => afterToolCallCtx({ name: "read", args: { path: "/tmp/x.txt" }, text: content });
			// First read: primes the dedup cache (no stub), counted as compression denominator.
			await session.agent.afterToolCall!(call());
			// Second read of identical content: dedup stub returned.
			await session.agent.afterToolCall!(call());

			const totals = session.getSavings();
			expect(totals.bySource.dedup.bytes).toBeGreaterThan(0);
			// dedup saving = fullText.length - stubLength; stub is short.
			expect(totals.bySource.dedup.bytes).toBeLessThan(content.length);
			expect(totals.bySource.dedup.bytes).toBeGreaterThan(content.length - 200);
		} finally {
			session.dispose();
		}
	});

	it("does not record compression for error results", async () => {
		const { session } = createSession({ cave: true });
		try {
			await session.agent.afterToolCall!(
				afterToolCallCtx({ name: "bash", args: {}, text: "line1\n\n\n\n\nline2", isError: true }),
			);
			const totals = session.getSavings();
			expect(totals.totalToolOutputBytes).toBe(0);
			expect(totals.bytesSaved).toBe(0);
		} finally {
			session.dispose();
		}
	});

	it("derives cache-reuse $ per-message from each message's own model (idempotent, separate)", () => {
		const { session } = createSession();
		try {
			session.agent.state.messages = [
				assistantWithCacheRead(model.id, 1_000_000, 1), // 1M × 2.7 / 1e6 = 2.7
				assistantWithCacheRead(haiku.id, 1_000_000, 2), // 1M × 0.9 / 1e6 = 0.9
				assistantWithCacheRead("totally-unknown-model", 1_000_000, 3), // unresolvable → 0
			];
			const first = session.getSavings();
			const second = session.getSavings();
			// Idempotent: derived-on-read, not accumulated.
			expect(first.cacheReuseDollars).toBeCloseTo(3.6, 9);
			expect(second.cacheReuseDollars).toBeCloseTo(3.6, 9);
			// Cache-reuse is SEPARATE from the caveman total.
			expect(first.bytesSaved).toBe(0);
			expect(first.dollarsSavedApprox).toBe(0);
		} finally {
			session.dispose();
		}
	});

	it("cache-reuse derivation degrades to 0 when there are no cache reads", () => {
		const { session } = createSession();
		try {
			session.agent.state.messages = [assistantWithCacheRead(model.id, 0, 1)];
			expect(session.getSavings().cacheReuseDollars).toBe(0);
		} finally {
			session.dispose();
		}
	});
});
