import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@zhachory1/mewrite-agent";
import type { AgentSession, AgentSessionEvent } from "../agent-session.js";
import { createAgentSession } from "../sdk.js";
import type { MessageRecord, SessionRecord } from "./protocol.js";
import type { AgentRunner, RunnerEmitter, RunnerFactory } from "./server.js";

interface AgentSessionLike {
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	prompt(text: string): Promise<void>;
	abort?(): Promise<void>;
	dispose?(): void;
}

export interface AgentBackedRunnerOptions {
	createSession?: (session: SessionRecord) => Promise<{ session: AgentSessionLike }>;
}

export function createAgentBackedRunnerFactory(options: AgentBackedRunnerOptions = {}): RunnerFactory {
	const createSession = options.createSession ?? defaultCreateSession;
	return (daemonSession, emit) => new AgentBackedRunner(daemonSession, emit, createSession);
}

class AgentBackedRunner implements AgentRunner {
	private sessionPromise?: Promise<AgentSessionLike>;
	private realizedSession?: AgentSessionLike;
	private unsubscribe?: () => void;
	private active = false;
	private closed = false;
	private cancelRequested = false;
	private terminalEmitted = false;
	private currentAssistantText = "";
	private lastAssistantMessageText?: string;

	constructor(
		private readonly daemonSession: SessionRecord,
		private readonly emit: RunnerEmitter,
		private readonly createSession: (session: SessionRecord) => Promise<{ session: AgentSessionLike }>,
	) {}

	async send(text: string): Promise<MessageRecord> {
		if (this.active) throw new Error("agent runner is already processing");
		const userMsg: MessageRecord = {
			id: `m_${randomUUID()}`,
			sessionId: this.daemonSession.id,
			role: "user",
			text,
			createdAt: new Date().toISOString(),
		};
		this.active = true;
		this.cancelRequested = false;
		this.terminalEmitted = false;
		this.currentAssistantText = "";
		this.lastAssistantMessageText = undefined;
		this.emit({ type: "message", message: userMsg });
		this.emit({ type: "state", sessionId: this.daemonSession.id, state: "running" });
		void this.runPrompt(text).catch((err) => {
			const message = err instanceof Error ? err.message : String(err);
			this.emitAssistantMessage(`Agent runner error: ${message}`);
			this.emitTerminal("error");
		});
		return userMsg;
	}

	interrupt(): void {
		this.cancelRequested = true;
		void this.realizedSession?.abort?.().finally(() => this.emitTerminal("stopped"));
	}

	close(): void {
		this.closed = true;
		this.cancelRequested = true;
		void this.realizedSession?.abort?.().finally(() => this.emitTerminal("stopped"));
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		void this.sessionPromise
			?.then((session) => {
				void session.abort?.();
				session.dispose?.();
			})
			.catch(() => {});
	}

	private async runPrompt(text: string): Promise<void> {
		const session = await this.ensureSession();
		if (this.closed || this.cancelRequested) {
			await session.abort?.();
			session.dispose?.();
			this.emitTerminal("stopped");
			return;
		}
		await session.prompt(text);
	}

	private async ensureSession(): Promise<AgentSessionLike> {
		if (!this.sessionPromise) {
			this.sessionPromise = this.createSession(this.daemonSession).then((result) => {
				this.realizedSession = result.session;
				this.unsubscribe = result.session.subscribe((event) => this.onEvent(event));
				return result.session;
			});
		}
		return this.sessionPromise;
	}

	private onEvent(event: AgentSessionEvent): void {
		if (this.closed) return;
		if (event.type === "message_update" && event.message.role === "assistant") {
			const delta = readTextDelta(event.assistantMessageEvent);
			if (delta) {
				this.currentAssistantText += delta;
				this.emit({ type: "token", sessionId: this.daemonSession.id, text: delta, role: "assistant" });
			}
			return;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const text = assistantDisplayText(event.message);
			this.emitAssistantFinalDelta(text);
			this.emitAssistantMessage(text);
			this.lastAssistantMessageText = text;
			return;
		}
		if (event.type === "tool_execution_start") {
			this.emit({ type: "tool", sessionId: this.daemonSession.id, name: event.toolName, status: "start" });
			return;
		}
		if (event.type === "tool_execution_end") {
			this.emit({
				type: "tool",
				sessionId: this.daemonSession.id,
				name: event.toolName,
				status: event.isError ? "err" : "ok",
			});
			return;
		}
		if (event.type === "agent_end") {
			const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
			const stopReason = lastAssistant && "stopReason" in lastAssistant ? lastAssistant.stopReason : undefined;
			if (stopReason === "error") {
				const text = lastAssistant ? assistantDisplayText(lastAssistant) : "Agent runner error";
				if (text && text !== this.lastAssistantMessageText) this.emitAssistantMessage(text);
				this.emitTerminal("error");
			} else {
				this.emitTerminal("idle");
			}
		}
	}

	private emitAssistantFinalDelta(fullText: string): void {
		if (fullText.length <= this.currentAssistantText.length) return;
		const delta = fullText.slice(this.currentAssistantText.length);
		this.currentAssistantText = fullText;
		this.emit({ type: "token", sessionId: this.daemonSession.id, text: delta, role: "assistant" });
	}

	private emitAssistantMessage(text: string): void {
		this.emit({
			type: "message",
			message: {
				id: `m_${randomUUID()}`,
				sessionId: this.daemonSession.id,
				role: "assistant",
				text,
				createdAt: new Date().toISOString(),
			},
		});
	}

	private emitTerminal(state: "idle" | "stopped" | "error"): void {
		if (this.terminalEmitted) return;
		this.active = false;
		this.terminalEmitted = true;
		this.emit({ type: "state", sessionId: this.daemonSession.id, state });
		this.emit({ type: "done", sessionId: this.daemonSession.id });
	}
}

async function defaultCreateSession(session: SessionRecord): Promise<{ session: AgentSession }> {
	return createAgentSession({ cwd: session.cwd });
}

function readTextDelta(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const typed = event as { type?: unknown; delta?: unknown };
	return typed.type === "text_delta" && typeof typed.delta === "string" ? typed.delta : undefined;
}

function assistantDisplayText(message: AgentMessage): string {
	if (message.role === "assistant") {
		const maybeError = message as AgentMessage & { errorMessage?: unknown };
		if (typeof maybeError.errorMessage === "string" && maybeError.errorMessage.trim()) {
			return maybeError.errorMessage;
		}
	}
	return messageText(message);
}

function messageText(message: AgentMessage): string {
	if (message.role !== "assistant" && message.role !== "user" && message.role !== "toolResult") return "";
	if (typeof message.content === "string") return message.content;
	return (message.content ?? [])
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}
