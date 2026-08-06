import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@zhachory1/mewrite-agent";
import type { AgentSession, AgentSessionEvent, ApprovalDecision, RequestApprovalFn } from "../agent-session.js";
import { createAgentSession } from "../sdk.js";
import { SessionManager } from "../session-manager.js";
import type { MessageRecord, SessionRecord } from "./protocol.js";
import type { AgentRunner, RunnerEmitter, RunnerFactory } from "./server.js";

interface AgentSessionLike {
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	prompt(text: string): Promise<void>;
	abort?(): Promise<void>;
	dispose?(): void;
	setApprovalCallback?(cb: RequestApprovalFn | undefined): void;
}

export interface AgentBackedRunnerOptions {
	createSession?: (session: SessionRecord, history?: HistoryMessage[]) => Promise<{ session: AgentSessionLike }>;
	/** Prior transcript for a session, used to seed the agent's context after a daemon
	 * restart (or first realization of a resumed session) so it remembers the chat. */
	loadHistory?: (sessionId: string) => HistoryMessage[];
}

/** Minimal shape the runner needs from a stored message to seed history. */
export interface HistoryMessage {
	role: string;
	text: string;
}

export function createAgentBackedRunnerFactory(options: AgentBackedRunnerOptions = {}): RunnerFactory {
	const createSession = options.createSession ?? defaultCreateSession;
	return (daemonSession, emit) => new AgentBackedRunner(daemonSession, emit, createSession, options.loadHistory);
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
	private pendingApprovals = new Map<string, { resolve: (decision: ApprovalDecision) => void; cleanup: () => void }>();

	constructor(
		private readonly daemonSession: SessionRecord,
		private readonly emit: RunnerEmitter,
		private readonly createSession: (
			session: SessionRecord,
			history?: HistoryMessage[],
		) => Promise<{ session: AgentSessionLike }>,
		private readonly loadHistory?: (sessionId: string) => HistoryMessage[],
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
		// Snapshot the prior transcript BEFORE recording this user message, so the
		// agent can be seeded with history that excludes the message it's about to
		// process (avoids duplicating the current turn). Only needed once, when the
		// underlying AgentSession is first realized.
		if (!this.sessionPromise && this.loadHistory) {
			try {
				this.pendingHistory = this.loadHistory(this.daemonSession.id);
			} catch {
				this.pendingHistory = undefined;
			}
		}
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
		this.cancelPendingApprovals();
		void this.realizedSession?.abort?.().finally(() => this.emitTerminal("stopped"));
	}

	close(): void {
		this.closed = true;
		this.cancelRequested = true;
		this.cancelPendingApprovals();
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

	private pendingHistory?: HistoryMessage[];

	private async ensureSession(): Promise<AgentSessionLike> {
		if (!this.sessionPromise) {
			const history = this.pendingHistory;
			this.pendingHistory = undefined;
			this.sessionPromise = this.createSession(this.daemonSession, history).then((result) => {
				this.realizedSession = result.session;
				result.session.setApprovalCallback?.(this.requestApproval);
				this.unsubscribe = result.session.subscribe((event) => this.onEvent(event));
				return result.session;
			});
		}
		return this.sessionPromise;
	}

	respondApproval(approvalId: string, decision: ApprovalDecision): void {
		const pending = this.pendingApprovals.get(approvalId);
		if (!pending) return;
		this.pendingApprovals.delete(approvalId);
		pending.cleanup();
		pending.resolve(decision);
	}

	cancelApprovals(): void {
		this.cancelPendingApprovals();
	}

	private requestApproval: RequestApprovalFn = (toolName, args, tier, signal) => {
		const approvalId = randomUUID();
		const delivered = this.emit({
			type: "approval",
			sessionId: this.daemonSession.id,
			approvalId,
			toolName,
			args,
			tier: String(tier),
		});
		if (!delivered) return Promise.resolve("deny");
		return new Promise<ApprovalDecision>((resolve) => {
			let settled = false;
			const finish = (decision: ApprovalDecision) => {
				if (settled) return;
				settled = true;
				this.pendingApprovals.delete(approvalId);
				cleanup();
				resolve(decision);
			};
			const timeout = setTimeout(() => finish("deny"), 5 * 60 * 1000);
			const onAbort = () => finish("deny");
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pendingApprovals.set(approvalId, { resolve: finish, cleanup });
		});
	};

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

	private cancelPendingApprovals(): void {
		for (const [approvalId, pending] of this.pendingApprovals) {
			this.pendingApprovals.delete(approvalId);
			pending.cleanup();
			pending.resolve("deny");
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

async function defaultCreateSession(
	session: SessionRecord,
	history?: HistoryMessage[],
): Promise<{ session: AgentSession }> {
	if (!history || history.length === 0) {
		return createAgentSession({ cwd: session.cwd });
	}
	// Seed an in-memory session manager with the prior transcript so the resumed
	// agent remembers the conversation the user can see in the view. Stored messages
	// only carry role + text; that is enough for context (tool-call structure is not
	// reconstructable from the store, so tool turns become plain text).
	const sessionManager = SessionManager.inMemory(session.cwd);
	for (const m of history) {
		if (!m.text.trim()) continue;
		const ts = Date.now();
		if (m.role === "assistant") {
			sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: m.text }],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "resumed",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: ts,
			});
		} else if (m.role === "user") {
			sessionManager.appendMessage({ role: "user", content: m.text, timestamp: ts });
		}
	}
	return createAgentSession({ cwd: session.cwd, sessionManager });
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
