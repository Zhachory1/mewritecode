import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";

describe("AgentSession.reload settings validation", () => {
	it.each([
		["removed", { memory: { backend: "zbrain" } }, "memory.backend"],
		["unknown", { contextEngine: { provider: "custom" } }, "contextEngine.provider"],
	])("rejects newly introduced %s settings before resource reload", async (_kind, settings, expected) => {
		const cwd = join(tmpdir(), `mewrite-reload-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			sessionManager: SessionManager.inMemory(),
		});
		let resourceReloads = 0;
		session.resourceLoader.reload = async () => {
			resourceReloads++;
		};

		try {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));

			await expect(session.reload()).rejects.toThrow(expected);
			expect(resourceReloads).toBe(0);
		} finally {
			session.dispose();
			if (existsSync(cwd)) {
				rmSync(cwd, { recursive: true, force: true });
			}
		}
	});
});
