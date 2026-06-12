import { Agent } from "@juliusbrussee/caveman-agent";
import { getModel } from "@juliusbrussee/caveman-ai";
import { describe, expect, it } from "vitest";
import { ActivityRegistry } from "../src/core/activity/activity-registry.js";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createSession(): AgentSession {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	return new AgentSession({
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
}

describe("AgentSession activity registry", () => {
	it("exposes an ActivityRegistry via the getter", () => {
		const session = createSession();
		try {
			expect(session.activityRegistry).toBeDefined();
			expect(session.activityRegistry).toBeInstanceOf(ActivityRegistry);
		} finally {
			session.dispose();
		}
	});

	it("dispose() is idempotent and disposes the registry (begin becomes a no-op)", () => {
		const session = createSession();
		const registry = session.activityRegistry;

		// Sanity: registry is live before dispose.
		registry.begin({ id: "pre", kind: "tool", label: "bash", startedAt: Date.now() });
		expect(registry.list()).toHaveLength(1);
		registry.clear();
		expect(registry.list()).toHaveLength(0);

		// First dispose.
		expect(() => session.dispose()).not.toThrow();
		// Second dispose is a no-op, must not throw.
		expect(() => session.dispose()).not.toThrow();

		// After dispose the registry is disposed: begin() is a no-op.
		registry.begin({ id: "post", kind: "tool", label: "bash", startedAt: Date.now() });
		expect(registry.list()).toHaveLength(0);
	});
});
