import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.js";
import { createAgentBackedRunnerFactory } from "../src/core/daemon/agent-runner.js";
import type { AgentRunner, RunnerEmitter } from "../src/core/daemon/index.js";
import type { SessionRecord } from "../src/core/daemon/protocol.js";

class FakeSession {
	protected listener?: (event: AgentSessionEvent) => void;
	aborted = false;
	disposed = false;

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
		const emit: RunnerEmitter = (event) => events.push(event);
		const runner: AgentRunner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session: new FakeSession() }),
		})(sessionRecord, emit);

		const user = await runner.send("hello");
		expect(user.role).toBe("user");
		await expect.poll(() => events.some((event) => (event as { type?: string }).type === "done")).toBe(true);

		expect(events).toContainEqual(expect.objectContaining({ type: "state", state: "running" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "token", text: "hel" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "token", text: "lo" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "read", status: "start" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "read", status: "ok" }));
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ role: "assistant", text: "hello" }),
			}),
		);
		expect(events).toContainEqual(expect.objectContaining({ type: "state", state: "idle" }));
	});

	it("reports encoded agent failures as error terminal state", async () => {
		const events: unknown[] = [];
		const emit: RunnerEmitter = (event) => events.push(event);
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

	it("rejects concurrent sends while an agent run is active", async () => {
		const events: unknown[] = [];
		const session = new NeverEndingSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => events.push(event));

		await runner.send("first");
		await expect(runner.send("second")).rejects.toThrow(/already processing/);
		session.release();
	});

	it("aborts active session on interrupt", async () => {
		const events: unknown[] = [];
		const session = new NeverEndingSession();
		const runner = createAgentBackedRunnerFactory({
			createSession: async () => ({ session }),
		})(sessionRecord, (event) => events.push(event));

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
		})(sessionRecord, (event) => events.push(event));

		await runner.send("first");
		runner.close();
		resolveCreate();
		await expect.poll(() => session.aborted).toBe(true);
		await expect.poll(() => events.some((event) => (event as { state?: string }).state === "stopped")).toBe(true);
		expect(prompted).toBe(false);
		expect(session.disposed).toBe(true);
	});
});
