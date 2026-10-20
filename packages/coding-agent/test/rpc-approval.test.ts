import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APPROVAL_DIALOG_CAPABILITY,
	APPROVAL_POLICY_VERSION,
	canonicalizeApprovalArguments,
	RpcApprovalChannel,
} from "../src/modes/rpc/rpc-approval.js";

type Record = { type: string; id: string; argumentsJson?: string; reason?: string };

function setup(negotiate = true) {
	const records: Record[] = [];
	const channel = new RpcApprovalChannel((record) => records.push(record as Record));
	if (negotiate) expect(channel.negotiate(structuredClone(APPROVAL_DIALOG_CAPABILITY))).toBe(true);
	return { channel, records, request: channel.bind() };
}

const reply = (id: string, decision: string, version = 1) => ({
	id,
	version,
	dangerPolicyVersion: APPROVAL_POLICY_VERSION,
	decision,
});

describe("RPC approval channel", () => {
	afterEach(() => vi.useRealTimers());

	it("denies without emitting anything until a client negotiates the exact capability", async () => {
		const { channel, records, request } = setup(false);
		expect(channel.negotiate({ ...APPROVAL_DIALOG_CAPABILITY, decisions: ["once", "session", "deny"] })).toBe(false);
		await expect(request("bash", { command: "ls" }, "exec")).resolves.toBe("deny");
		expect(records).toEqual([]);
	});

	it("emits canonical arguments and allows only a valid once reply", async () => {
		const { channel, records, request } = setup();
		const decision = request("bash", { z: 1, command: "rm\u200b -rf" }, "destructive");
		expect(records[0]).toMatchObject({ type: "approval_request", tier: "destructive", decisions: ["once", "deny"] });
		expect(records[0].argumentsJson).toBe('{"command":"rm\\u200b -rf","z":1}');
		channel.handleResponse(reply(records[0].id, "once"));
		await expect(decision).resolves.toBe("once");

		const second = request("write", { path: "a" }, "write");
		channel.handleResponse(reply(records[1].id, "once", 2));
		await expect(second).resolves.toBe("deny");

		const third = request("write", { path: "a" }, "write");
		channel.handleResponse(reply(records[2].id, "session"));
		await expect(third).resolves.toBe("deny");
	});

	it("denies on timeout, abort, rebind, and shutdown with approval_closed", async () => {
		vi.useFakeTimers();
		const { channel, records, request } = setup();
		const timedOut = request("bash", { command: "ls" }, "exec");
		vi.advanceTimersByTime(120_000);
		await expect(timedOut).resolves.toBe("deny");

		const controller = new AbortController();
		const aborted = request("bash", { command: "ls" }, "exec", controller.signal);
		controller.abort();
		await expect(aborted).resolves.toBe("deny");

		const stale = request("bash", { command: "ls" }, "exec");
		const fresh = channel.bind();
		await expect(stale).resolves.toBe("deny");
		await expect(request("bash", { command: "ls" }, "exec")).resolves.toBe("deny");

		const pending = fresh("bash", { command: "ls" }, "exec");
		channel.close();
		await expect(pending).resolves.toBe("deny");
		await expect(fresh("bash", { command: "ls" }, "exec")).resolves.toBe("deny");

		expect(records.filter((r) => r.type === "approval_closed").map((r) => r.reason)).toEqual([
			"timeout",
			"aborted",
			"session_replaced",
			"shutdown",
		]);
	});

	it("denies a pending request when the client renegotiates a mismatched capability", async () => {
		const { channel, records, request } = setup();
		const pending = request("bash", { command: "ls" }, "exec");
		expect(channel.negotiate({ version: 2 })).toBe(false);
		channel.handleResponse(reply(records[0].id, "once"));
		await expect(pending).resolves.toBe("deny");
		expect(records.at(-1)).toMatchObject({ type: "approval_closed", reason: "capability_changed" });
	});

	it("denies oversized or unrepresentable arguments without a request", async () => {
		const { records, request } = setup();
		await expect(request("write", { content: "x".repeat(9000) }, "write")).resolves.toBe("deny");
		await expect(request("write", { n: Number.NaN }, "write")).resolves.toBe("deny");
		await expect(request("write", { when: new Date(0) }, "write")).resolves.toBe("deny");
		expect(records).toEqual([]);
		expect(() => canonicalizeApprovalArguments({ a: undefined })).toThrow();
	});
});
