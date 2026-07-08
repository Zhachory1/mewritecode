import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentEvent } from "@zhachory1/mewrite-agent";
import { type AssistantMessage, getModel, type Usage } from "@zhachory1/mewrite-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { getCostLedgerPath, getTodayTotal, readCostLedgerRecords } from "../src/core/cost-persistence.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number, dollars = 0): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: dollars,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: dollars,
		},
	};
}

function createAssistantMessage(text: string, totalTokens: number, timestamp: number, dollars = 0): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens, dollars),
		stopReason: "stop",
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp,
	};
}

function createSession() {
	const settingsManager = SettingsManager.inMemory();
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

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

function setHomeForTest(home: string): () => void {
	const previous = process.env.HOME;
	process.env.HOME = home;
	return () => {
		if (previous === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previous;
		}
	};
}

async function processAgentEvent(session: AgentSession, event: AgentEvent): Promise<void> {
	const harness = session as unknown as { _processAgentEvent(event: AgentEvent): Promise<void> };
	await harness._processAgentEvent(event);
}

describe("AgentSession cost ledger", () => {
	it("persists assistant message cost on message_end", async () => {
		const tmpHome = mkdtempSync(join(tmpdir(), "cave-cost-home-"));
		const restoreHome = setHomeForTest(tmpHome);
		const { session, sessionManager } = createSession();

		try {
			const message = createAssistantMessage("priced", 123, Date.now(), 0.0123);
			await processAgentEvent(session, { type: "message_end", message });

			const [entry] = sessionManager.getEntries();
			expect(entry?.type).toBe("message");
			const records = readCostLedgerRecords(getCostLedgerPath());
			expect(records).toHaveLength(1);
			expect(records[0]).toMatchObject({
				id: `${session.sessionId}:${entry?.id}`,
				sessionId: session.sessionId,
				input: 123,
				dollars: 0.0123,
			});
			expect(getTodayTotal()?.input).toBe(123);
		} finally {
			session.dispose();
			restoreHome();
			rmSync(tmpHome, { recursive: true, force: true });
		}
	});
});

describe("AgentSession.getSessionStats", () => {
	it("exposes the current context usage alongside token totals", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			expect(stats.contextUsage?.tokens).toBe(200);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports unknown current context usage immediately after compaction", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(195_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBeNull();
			expect(stats.contextUsage?.percent).toBeNull();
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(220_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});
});
