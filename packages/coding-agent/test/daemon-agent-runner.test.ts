import type { ThinkingLevel } from "@zhachory1/mewrite-agent";
import { describe, expect, it } from "vitest";
import type { AgentSessionEvent, RequestApprovalFn } from "../src/core/agent-session.js";
import { createAgentBackedRunnerFactory } from "../src/core/daemon/agent-runner.js";
import type { AgentRunner, RunnerEmitter } from "../src/core/daemon/index.js";
import type { SessionRecord } from "../src/core/daemon/protocol.js";

class FakeSession {
	protected listener?: (event: AgentSessionEvent) => void;
	aborted = false;
	disposed = false;
	approvalCallback?: RequestApprovalFn;

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	async abort(): Promise<void> {
		this.aborted = true;
	}

	dispose(): void {
		this.disposed = true;
	}

	setApprovalCallback(cb: RequestApprovalFn | undefined): void {
		this.approvalCallback = cb;
	}

	thinkingLevel: ThinkingLevel = "medium";
	lastThinking?: ThinkingLevel;
	setThinkingLevel(level: ThinkingLevel): void {
		this.thinkingLevel = level;
		this.lastThinking = level;
	}

	getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined {
		return { tokens: 1000, contextWindow: 200000, percent: 0.5 };
	}

	async prompt(_text: string): Promise<void> {
		this.listener?.({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "hel" }], timestamp: Date.now() },
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hel" },
		} as AgentSessionEvent);
		this.listener?.({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
			startedAt: Date.now(),
		} as AgentSessionEvent);
		this.listener?.({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "read",
			result: {},
			isError: false,
		} as AgentSessionEvent);
		this.listener?.({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
		} as AgentSessionEvent);
		this.listener?.({ type: "agent_end", messages: [] } as unknown as AgentSessionEvent);
	}
}

class ErrorEndSession extends FakeSession {
	override async prompt(_text: string): Promise<void> {
		this.listener?.({
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					content: [],
					errorMessage: "provider failed",
					stopReason: "error",
					timestamp: Date.now(),
				},
			],
		} as unknown as AgentSessionEvent);
	}
}

// Emits agent_end(error, aborted-for-retry) -> auto_retry_start -> agent_end(stop),
// mirroring a provider stall that recovers on auto-retry. The daemon runner must
// end at "idle", not stay stuck on the premature "error".
class RetryThenSucceedSession extends FakeSession {
	override async prompt(_text: string): Promise<void> {
		this.listener?.({
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					content: [],
					errorMessage: "Model stream idle for 120000ms; aborted for retry",
					stopReason: "error",
					timestamp: Date.now(),
				},
			],
		} as unknown as AgentSessionEvent);
		this.listener?.({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 0,
			errorMessage: "idle timeout",
		} as unknown as AgentSessionEvent);
		this.listener?.({ type: "auto_retry_end", success: true, attempt: 1 } as unknown as AgentSessionEvent);
		this.listener?.({
			type: "agent_end",
			messages: [{ role: "assistant", content: [], stopReason: "stop", timestamp: Date.now() }],
		} as unknown as AgentSessionEvent);
	}
}

class ApprovalSession extends FakeSession {
	decision?: string;
	override async prompt(_text: string): Promise<void> {
		this.decision = await this.approvalCallback?.("write", { path: "file.txt" }, "write" as never);
		this.listener?.({ type: "agent_end", messages: [] } as unknown as AgentSessionEvent);
	}
}

class NeverEndingSession extends FakeSession {
	release!: () => void;
	override async prompt(_text: string): Promise<void> {
		await new Promise<void>((resolve) => {
			this.release = resolve;
		});
	}
}

const sessionRecord: SessionRecord = {
	id: "session-1",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	state: "idle",
	cwd: process.cwd(),
};

describe("agent-backed daemon runner", () => {
	it("bridges session events to daemon runner events", async () => {
		const events: unknown[] = [];
		const emit: RunnerEmitter = (event) => {
			events.push(event);
			return true;
		};
		const runner: AgentRunner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new FakeSession() }),
		})(sessionRecord, emit);

		const user = await runner.send("hello");
		expect(user.role).toBe("user");
		await expect.poll(() => events.some((event) => (event as { type?: string }).type === "done")).toBe(true);

		expect(events).toContainEqual(expect.objectContaining({ type: "state", state: "running" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "token", text: "hel" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "token", text: "lo" }));
		expect(events).toContainEqual(
			expect.objectContaining({ type: "tool", name: "read", status: "start", toolCallId: "tool-1", args: {} }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool",
				name: "read",
				status: "ok",
				toolCallId: "tool-1",
				isError: false,
				result: {},
			}),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "usage", tokens: 1000, contextWindow: 200000, thinkingLevel: "medium" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ role: "assistant", text: "hello" }),
			}),
		);
		expect(events).toContainEqual(expect.objectContaining({ type: "state", state: "idle" }));
	});

	it("seeds the agent with prior transcript history (excluding the current message)", async () => {
		const emit: RunnerEmitter = () => true;
		let seeded: Array<{ role: string; text: string }> | undefined;
		const prior = [
			{ role: "user", text: "what is 2+2" },
			{ role: "assistant", text: "4" },
		];
		const runner = createAgentBackedRunnerFactory({
			loadHistory: () => prior,
			createSession: async (_session, history) => {
				seeded = history;
				return { session: new FakeSession() };
			},
		})(sessionRecord, emit);

		await runner.send("and 3+3?");
		await expect.poll(() => seeded !== undefined).toBe(true);
		// The agent is seeded with the prior turns, NOT the message it's processing now.
		expect(seeded).toEqual(prior);
	});

	it("reports encoded agent failures as error terminal state", async () => {
		const events: unknown[] = [];
		const emit: RunnerEmitter = (event) => {
			events.push(event);
			return true;
		};
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new ErrorEndSession() }),
		})(sessionRecord, emit);

		await runner.send("fail");
		await expect.poll(() => events.some((event) => (event as { type?: string }).type === "done")).toBe(true);

		expect(events).toContainEqual(expect.objectContaining({ type: "state", state: "error" }));
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ role: "assistant", text: "provider failed" }),
			}),
		);
	});

	it("recovers to idle when an aborted-for-retry turn succeeds on auto-retry", async () => {
		const events: { type?: string; state?: string }[] = [];
		const emit: RunnerEmitter = (event) => {
			events.push(event as { type?: string; state?: string });
			return true;
		};
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new RetryThenSucceedSession() }),
		})(sessionRecord, emit);

		await runner.send("do it");
		await expect.poll(() => events.filter((e) => e.type === "done").length >= 1).toBe(true);

		// The final terminal state must be idle, not the premature error.
		const states = events.filter((e) => e.type === "state").map((e) => e.state);
		expect(states[states.length - 1]).toBe("idle");
		// It did pass through error->running->idle (premature error undone by retry).
		expect(states).toContain("error");
		expect(states).toContain("running");
	});

	it("rejects concurrent sends while an agent run is active", async () => {
		const events: unknown[] = [];
		const session = new NeverEndingSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => {
			events.push(event);
			return true;
		});

		await runner.send("first");
		await expect(runner.send("second")).rejects.toThrow(/already processing/);
		session.release();
	});

	it("aborts active session on interrupt", async () => {
		const events: unknown[] = [];
		const session = new NeverEndingSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => {
			events.push(event);
			return true;
		});

		await runner.send("first");
		await expect.poll(() => typeof session.release).toBe("function");
		runner.interrupt();
		await expect.poll(() => session.aborted).toBe(true);
		await expect.poll(() => events.some((event) => (event as { state?: string }).state === "stopped")).toBe(true);
		session.release();
	});

	it("close before session creation completes prevents prompt", async () => {
		const events: unknown[] = [];
		const session = new FakeSession();
		let prompted = false;
		let resolveCreate!: () => void;
		const createStarted = new Promise<void>((resolve) => {
			resolveCreate = resolve;
		});
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => {
				await createStarted;
				return {
					session: {
						...session,
						subscribe: session.subscribe.bind(session),
						abort: session.abort.bind(session),
						dispose: session.dispose.bind(session),
						prompt: async () => {
							prompted = true;
						},
					},
				};
			},
		})(sessionRecord, (event) => {
			events.push(event);
			return true;
		});

		await runner.send("first");
		runner.close();
		resolveCreate();
		await expect.poll(() => session.aborted).toBe(true);
		await expect.poll(() => events.some((event) => (event as { state?: string }).state === "stopped")).toBe(true);
		expect(prompted).toBe(false);
		expect(session.disposed).toBe(true);
	});

	it("waits for browser approval decisions", async () => {
		const events: unknown[] = [];
		const session = new ApprovalSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => {
			events.push(event);
			return true;
		});

		await runner.send("approve");
		await expect.poll(() => events.find((event) => (event as { type?: string }).type === "approval")).toBeTruthy();
		const approval = events.find((event) => (event as { type?: string }).type === "approval") as {
			approvalId: string;
		};
		runner.respondApproval?.(approval.approvalId, "once");
		await expect.poll(() => session.decision).toBe("once");
	});

	it("denies approval when no browser client receives the request", async () => {
		const session = new ApprovalSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, () => false);

		await runner.send("approve");
		await expect.poll(() => session.decision).toBe("deny");
	});

	it("emits stopReason on the terminal state", async () => {
		const events: { type?: string; state?: string; stopReason?: string }[] = [];
		const emit: RunnerEmitter = (event) => {
			events.push(event as { type?: string; state?: string; stopReason?: string });
			return true;
		};
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new FakeSession() }),
		})(sessionRecord, emit);

		await runner.send("hello");
		await expect.poll(() => events.some((e) => e.type === "done")).toBe(true);
		const terminal = events.filter((e) => e.type === "state" && e.state === "idle").at(-1);
		expect(terminal?.stopReason).toBe("stop");
	});

	it("maps a max_tokens stop reason", async () => {
		class MaxTokensSession extends FakeSession {
			override async prompt(_text: string): Promise<void> {
				this.listener?.({
					type: "agent_end",
					messages: [{ role: "assistant", content: [], stopReason: "length", timestamp: Date.now() }],
				} as unknown as AgentSessionEvent);
			}
		}
		const events: { type?: string; state?: string; stopReason?: string }[] = [];
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new MaxTokensSession() }),
		})(sessionRecord, (event) => {
			events.push(event as { type?: string; state?: string; stopReason?: string });
			return true;
		});

		await runner.send("go");
		await expect.poll(() => events.some((e) => e.type === "done")).toBe(true);
		const terminal = events.filter((e) => e.type === "state" && e.state === "idle").at(-1);
		expect(terminal?.stopReason).toBe("max_tokens");
	});

	it("requestUsage re-emits a usage snapshot after a turn, and is a no-op before realization", async () => {
		const events: { type?: string; thinkingLevel?: string; tokens?: number | null }[] = [];
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new FakeSession() }),
		})(sessionRecord, (event) => {
			events.push(event as { type?: string; thinkingLevel?: string; tokens?: number | null });
			return true;
		});

		// Before the session is realized, requestUsage emits nothing (usage unknown).
		runner.requestUsage?.();
		expect(events.filter((e) => e.type === "usage")).toHaveLength(0);

		// Run a turn so the session is realized, then a fresh attach re-requests usage.
		await runner.send("hello");
		await expect.poll(() => events.some((e) => e.type === "done")).toBe(true);
		const before = events.filter((e) => e.type === "usage").length;
		runner.requestUsage?.();
		const after = events.filter((e) => e.type === "usage");
		expect(after.length).toBe(before + 1);
		expect(after.at(-1)).toMatchObject({ tokens: 1000, contextWindow: 200000 });
	});

	it("set_thinking updates the session and echoes a usage event", async () => {
		const events: { type?: string; thinkingLevel?: string }[] = [];
		const session = new NeverEndingSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => {
			events.push(event as { type?: string; thinkingLevel?: string });
			return true;
		});

		await runner.send("first");
		await expect.poll(() => typeof session.release).toBe("function");
		runner.setThinking?.("high");
		expect(session.lastThinking).toBe("high");
		const usage = events.filter((e) => e.type === "usage").at(-1);
		expect(usage?.thinkingLevel).toBe("high");
		session.release();
	});
});
