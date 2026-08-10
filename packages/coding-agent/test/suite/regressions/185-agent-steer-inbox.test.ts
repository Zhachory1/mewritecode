/**
 * #185 phase C+ — cross-process steering inbox.
 *
 * The agents view writes redirects to a spawned agent's inbox; the agent's own
 * process watches the file and injects them into its steering queue. These cover
 * the path helper, that only messages appended AFTER watching are delivered (no
 * replay of old redirects), and that delivery picks steer vs plain prompt by the
 * session's streaming state.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

// getAgentDir() derives from the config dir under HOME; point HOME at a temp dir
// so the inbox writes somewhere disposable and isolated per test.
beforeEach(() => {
	tmpHome = mkdtempSync(join(tmpdir(), "cave-inbox-"));
	vi.stubEnv("HOME", tmpHome);
	vi.stubEnv("USERPROFILE", tmpHome);
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(tmpHome, { recursive: true, force: true });
});

class FakeSession {
	isStreaming = false;
	calls: Array<{ text: string; steer: boolean }> = [];
	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		this.calls.push({ text, steer: options?.streamingBehavior === "steer" });
	}
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("#185 agent steering inbox", () => {
	it("derives a stable, id-based inbox path", async () => {
		const { agentInboxPath } = await import("../../../src/core/agent-inbox.js");
		expect(agentInboxPath("abc")).toBe(agentInboxPath("abc"));
		expect(agentInboxPath("abc")).not.toBe(agentInboxPath("def"));
		expect(agentInboxPath("abc").endsWith("agent-inbox/abc.jsonl")).toBe(true);
	});

	it("delivers messages appended after watching, not old ones, and picks steer vs prompt", async () => {
		const { sendAgentSteer, startInboxSteer } = await import("../../../src/core/agent-inbox.js");
		const id = "sess-1";
		// A pre-existing redirect must NOT be replayed once we start watching.
		sendAgentSteer(id, "OLD - should be ignored");

		const session = new FakeSession();
		const dispose = startInboxSteer(session, id);
		try {
			// Idle -> delivered as a plain prompt.
			sendAgentSteer(id, "do X instead");
			await vi.waitFor(() => expect(session.calls.length).toBe(1), { timeout: 2000, interval: 50 });
			expect(session.calls[0]).toEqual({ text: "do X instead", steer: false });

			// Streaming -> delivered as a steer.
			session.isStreaming = true;
			sendAgentSteer(id, "actually do Y");
			await vi.waitFor(() => expect(session.calls.length).toBe(2), { timeout: 2000, interval: 50 });
			expect(session.calls[1]).toEqual({ text: "actually do Y", steer: true });

			// The pre-watch message was never delivered.
			expect(session.calls.some((c) => c.text.includes("OLD"))).toBe(false);
		} finally {
			dispose();
			await wait(10);
		}
	});
});
