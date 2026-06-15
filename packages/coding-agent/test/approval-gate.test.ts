/**
 * Gate wiring tests for OPT-IN approval mode (#14).
 *
 * The CRITICAL guarantee here is the autopilot parity: with approval mode OFF
 * (the default), the approval callback is NEVER invoked — the gate short-circuits
 * before any policy code runs. We also verify deny/once/session behavior, the
 * deny-by-default for headless (no callback), and that turning the mode on forces
 * sequential tool execution so concurrent calls can't race the prompt.
 */

import { describe, expect, it, vi } from "vitest";
import type { ApprovalDecision } from "../src/core/agent-session.js";
import { createTestSession } from "./utilities.js";

/** Invoke the registered beforeToolCall hook with a synthetic tool call. */
async function fireBeforeToolCall(
	session: ReturnType<typeof createTestSession>["session"],
	toolName: string,
	args: unknown,
	signal?: AbortSignal,
) {
	// The session installs agent.beforeToolCall in its constructor.
	const hook = (
		session as unknown as {
			agent: {
				beforeToolCall?: (
					ctx: unknown,
					signal?: AbortSignal,
				) => Promise<{ block?: boolean; reason?: string } | undefined>;
			};
		}
	).agent.beforeToolCall;
	if (!hook) return undefined;
	return hook(
		{
			toolCall: { type: "toolCall", id: "tc1", name: toolName, arguments: args },
			args,
		},
		signal,
	);
}

describe("approval gate — autopilot parity (mode OFF)", () => {
	it("never invokes the approval callback when mode is off", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "deny");
			session.setApprovalCallback(cb);
			expect(session.approvalMode).toBe(false);

			// Even a write/bash call must NOT be gated when mode is off.
			const a = await fireBeforeToolCall(session, "write", { path: "x", content: "y" });
			const b = await fireBeforeToolCall(session, "bash", { command: "rm -rf /" });

			expect(cb).not.toHaveBeenCalled();
			// undefined == allowed (no block)
			expect(a).toBeUndefined();
			expect(b).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	it("leaves tool execution at parallel when mode is off", () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			expect((session as unknown as { agent: { toolExecution: string } }).agent.toolExecution).toBe("parallel");
		} finally {
			cleanup();
		}
	});
});

describe("approval gate — mode ON", () => {
	it("reads run free (callback never consulted)", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "deny");
			session.setApprovalCallback(cb);
			session.setApprovalMode(true);

			const res = await fireBeforeToolCall(session, "read", { path: "f" });
			expect(res).toBeUndefined();
			expect(cb).not.toHaveBeenCalled();
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("forces sequential tool execution when on, restores parallel when off", () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const agent = (session as unknown as { agent: { toolExecution: string } }).agent;
			session.setApprovalMode(true);
			expect(agent.toolExecution).toBe("sequential");
			session.setApprovalMode(false);
			expect(agent.toolExecution).toBe("parallel");
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	// MED-1: turning approval OFF must restore the ORIGINAL tool-execution mode
	// (captured before the first override), NOT a hardcoded "parallel". A host that
	// intentionally ran sequential must get sequential back.
	it("restores the ORIGINAL tool-execution mode when off (not hardcoded parallel)", () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const agent = (session as unknown as { agent: { toolExecution: string } }).agent;
			// Host intentionally ran sequential before approval mode was ever toggled.
			agent.toolExecution = "sequential";
			session.setApprovalMode(true);
			expect(agent.toolExecution).toBe("sequential");
			session.setApprovalMode(false);
			// Must come back to the captured original ("sequential"), not "parallel".
			expect(agent.toolExecution).toBe("sequential");
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	// LOW-3: a programmatic abort while the approval prompt is pending must resolve
	// to deny and NOT hang the loop. We simulate a callback that never resolves on
	// its own and abort the signal mid-flight.
	it("aborting while the approval prompt is pending resolves deny (no hang)", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const controller = new AbortController();
			let signalReceived: AbortSignal | undefined;
			// Callback that never resolves on its own — only the abort race can.
			session.setApprovalCallback((_t, _a, _tier, signal) => {
				signalReceived = signal;
				return new Promise<ApprovalDecision>(() => {});
			});
			session.setApprovalMode(true);

			const pending = fireBeforeToolCall(session, "write", { path: "x", content: "y" }, controller.signal);
			// Abort after the gate has started awaiting the (never-resolving) prompt.
			await Promise.resolve();
			controller.abort();

			const res = await pending;
			expect(res).toMatchObject({ block: true });
			expect((res as { reason: string }).reason).toContain("denied by user");
			// The signal was threaded into the callback (so the prompt can self-dismiss).
			expect(signalReceived).toBe(controller.signal);
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	// LOW-3: an already-aborted signal short-circuits to deny without ever calling
	// the prompt.
	it("an already-aborted signal denies immediately", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const controller = new AbortController();
			controller.abort();
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "once");
			session.setApprovalCallback(cb);
			session.setApprovalMode(true);

			const res = await fireBeforeToolCall(session, "write", { path: "x", content: "y" }, controller.signal);
			expect(res).toMatchObject({ block: true });
			expect(cb).not.toHaveBeenCalled();
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("deny blocks the tool with a reason", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			session.setApprovalCallback(async () => "deny");
			session.setApprovalMode(true);
			const res = await fireBeforeToolCall(session, "write", { path: "x", content: "y" });
			expect(res).toMatchObject({ block: true });
			expect((res as { reason: string }).reason).toContain("denied by user");
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("approve-once allows but re-prompts next time", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "once");
			session.setApprovalCallback(cb);
			session.setApprovalMode(true);
			await fireBeforeToolCall(session, "bash", { command: "ls" });
			await fireBeforeToolCall(session, "bash", { command: "pwd" });
			expect(cb).toHaveBeenCalledTimes(2);
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("approve-for-session does not re-prompt the same tool", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "session");
			session.setApprovalCallback(cb);
			session.setApprovalMode(true);
			const a = await fireBeforeToolCall(session, "bash", { command: "ls" });
			const b = await fireBeforeToolCall(session, "bash", { command: "pwd" });
			expect(a).toBeUndefined();
			expect(b).toBeUndefined();
			expect(cb).toHaveBeenCalledTimes(1);
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("headless (no callback) denies by default — never silent-allow", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			session.setApprovalCallback(undefined);
			session.setApprovalMode(true);
			const res = await fireBeforeToolCall(session, "write", { path: "x", content: "y" });
			expect(res).toMatchObject({ block: true });
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});

	it("turning mode off clears session-approved tools", async () => {
		const { session, cleanup } = createTestSession({ inMemory: true });
		try {
			const cb = vi.fn(async (): Promise<ApprovalDecision> => "session");
			session.setApprovalCallback(cb);
			session.setApprovalMode(true);
			await fireBeforeToolCall(session, "bash", { command: "ls" });
			session.setApprovalMode(false);
			session.setApprovalMode(true);
			await fireBeforeToolCall(session, "bash", { command: "ls" });
			// re-prompted after the off/on cycle
			expect(cb).toHaveBeenCalledTimes(2);
		} finally {
			session.setApprovalMode(false);
			cleanup();
		}
	});
});
