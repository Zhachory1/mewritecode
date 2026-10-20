import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@zhachory1/mewrite-agent";
import { fauxAssistantMessage, fauxToolCall } from "@zhachory1/mewrite-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	APPROVAL_DIALOG_CAPABILITY,
	APPROVAL_POLICY_VERSION,
	RpcApprovalChannel,
} from "../../src/modes/rpc/rpc-approval.js";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession with the RPC approval channel", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function run(decision: "once" | "deny") {
		let executed = 0;
		const writeTool: AgentTool = {
			name: "write",
			label: "Write",
			description: "Write a file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async () => {
				executed++;
				return { content: [{ type: "text", text: "written" }], details: {} };
			},
		};
		const harness = await createHarness({ tools: [writeTool], settings: { approvalMode: true } });
		harnesses.push(harness);
		const channel = new RpcApprovalChannel((record) => {
			const request = record as { type: string; id: string; tier: string; argumentsJson: string };
			if (request.type !== "approval_request") return;
			expect(request.tier).toBe("write");
			expect(request.argumentsJson).toBe('{"path":"a.txt"}');
			queueMicrotask(() =>
				channel.handleResponse({
					id: request.id,
					version: 1,
					dangerPolicyVersion: APPROVAL_POLICY_VERSION,
					decision,
				}),
			);
		});
		channel.negotiate(APPROVAL_DIALOG_CAPABILITY);
		harness.session.setApprovalCallback(channel.bind());
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("write it");
		return { executed, harness };
	}

	it("runs a guarded tool after a once reply", async () => {
		expect((await run("once")).executed).toBe(1);
	});

	it("drops allow-for-session grants when the approval callback is replaced", async () => {
		const { harness } = await run("once");
		let asked = 0;
		harness.session.setApprovalCallback(async () => {
			asked++;
			return "session";
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "b.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("again");
		expect(asked).toBe(1);

		harness.session.setApprovalCallback(async () => {
			asked++;
			return "deny";
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "c.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("once more");
		expect(asked).toBe(2);
	});

	it("blocks a guarded tool after a deny reply", async () => {
		const { executed, harness } = await run("deny");
		expect(executed).toBe(0);
		expect(harness.session.messages.some((m) => m.role === "toolResult" && m.isError)).toBe(true);
	});
});
