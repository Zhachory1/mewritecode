/**
 * Regression for #61 — `/btw <question>` slash command + `AgentSession.askSidecar`.
 *
 * V1 behavior pinned here:
 *   1. `askSidecar(question)` returns the assistant's text answer.
 *   2. The conversation's `agent.state.messages` is NOT mutated by the call —
 *      the side query does not contaminate the agent's working memory.
 *   3. The call can run while a regular `prompt()` turn is mid-flight.
 *   4. Empty / whitespace-only questions throw rather than firing a no-op
 *      completion.
 */

import type { AgentTool } from "@zhachory1/mewrite-agent";
import { fauxAssistantMessage, fauxToolCall } from "@zhachory1/mewrite-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

describe("#61 /btw side-question", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("returns the assistant text from a one-shot sidecar completion", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("the side answer")]);

		const answer = await harness.session.askSidecar("what does dedupePrompts do?");

		expect(answer).toBe("the side answer");
	});

	it("does NOT mutate agent.state.messages — side queries are pure", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("side")]);

		const beforeLen = harness.session.messages.length;
		const beforeJson = JSON.stringify(harness.session.messages);

		await harness.session.askSidecar("hello");

		const afterLen = harness.session.messages.length;
		const afterJson = JSON.stringify(harness.session.messages);

		expect(afterLen).toBe(beforeLen);
		expect(afterJson).toBe(beforeJson);
	});

	it("throws on empty / whitespace-only question", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await expect(harness.session.askSidecar("")).rejects.toThrow(/empty question/);
		await expect(harness.session.askSidecar("   \n  ")).rejects.toThrow(/empty question/);
	});

	it("can run while a regular prompt() turn is mid-flight (side answer arrives independently)", async () => {
		// Drive a primary turn that pauses on a `wait` tool; while it's paused,
		// fire `askSidecar()` and assert it resolves before we release the tool.
		let releaseTool: (() => void) | undefined;
		const toolPaused = new Promise<void>((resolve) => {
			releaseTool = resolve;
		});

		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Block until the test releases",
			parameters: Type.Object({}),
			execute: async () => {
				await toolPaused;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [waitTool] });
		harnesses.push(harness);

		// Faux provider serves responses from a FIFO queue across all requests.
		// Order: 1st = primary's tool call; 2nd = sidecar (it fires while tool is
		// paused); 3rd = primary's wrap-up (after tool releases).
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("sidecar response"),
			fauxAssistantMessage("primary turn done"),
		]);

		// Kick off the primary turn (this DOES NOT await — it's still running).
		const sawToolStart = new Promise<void>((resolve) => {
			const off = harness.session.subscribe((e) => {
				if (e.type === "tool_execution_start" && e.toolName === "wait") {
					off();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("primary task");
		await sawToolStart;

		// Sidecar fires while the primary turn is paused on the tool.
		const sideAnswer = await harness.session.askSidecar("a quick side question");
		expect(sideAnswer).toBe("sidecar response");

		// Now release the tool and let the primary turn finish.
		releaseTool?.();
		await promptPromise;

		// After everything settles, the messages should include the primary turn's
		// user/assistant/tool-result triplet but NOT the sidecar question or answer.
		const userTexts = harness.session.messages
			.filter((m) => m.role === "user")
			.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text);
		expect(userTexts).toContain("primary task");
		expect(userTexts).not.toContain("a quick side question");

		const assistantTexts = harness.session.messages
			.filter((m) => m.role === "assistant")
			.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text);
		expect(assistantTexts).toContain("primary turn done");
		expect(assistantTexts).not.toContain("sidecar response");
	});
});
