import { randomUUID } from "node:crypto";

export const DIAGNOSTICS_SCHEMA_VERSION = 1;
export const DIAGNOSTICS_EVENT_SCHEMA_VERSION = 1;

export type DiagnosticsOutcome = "ok" | "error" | "cancelled" | "timeout";
export type DiagnosticsSource = "core" | "coding-agent";

export interface DiagnosticsEventEnvelope<TType extends string, TAttributes extends Record<string, unknown>> {
	schemaVersion: 1;
	eventSchemaVersion: 1;
	eventId: string;
	sessionId: string;
	timestamp: string;
	type: TType;
	source: DiagnosticsSource;
	durationMs?: number;
	outcome?: DiagnosticsOutcome;
	attributes: TAttributes;
}

export interface SessionAttributes extends Record<string, unknown> {
	appVersion: string;
	packageEntryPoint?: string;
	exitReason?: "completed" | "cancelled" | "error" | "crash";
}

export interface CommandAttributes extends Record<string, unknown> {
	commandName: string;
	commandKind: "cli" | "slash" | "keybinding";
	success: boolean;
}

export interface TurnAttributes extends Record<string, unknown> {
	turnIndex: number;
	/**
	 * Why the turn ended, derived from the model stop reason and whether tool
	 * calls were issued. This is the primary signal for diagnosing mid-task
	 * stalls (#154):
	 *   - "tool_batch_await" — model issued tool calls; loop will continue.
	 *   - "end_turn" — model stopped cleanly with no tool calls (yielded to user).
	 *   - "max_tokens" — response truncated at the token limit.
	 *   - "error" | "aborted" — stream failed or was cancelled.
	 *   - "pause" — provider paused a long turn (non-terminal, re-streamed).
	 */
	turnReason: "tool_batch_await" | "end_turn" | "max_tokens" | "error" | "aborted" | "pause";
	stopReason?: string;
	toolCallCount: number;
	hadToolResults: boolean;
}

export interface ModelRequestAttributes extends Record<string, unknown> {
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	stopReason?: string;
	retryCount: number;
	errorClass?: string;
}

export interface ToolCallAttributes extends Record<string, unknown> {
	toolName: string;
	toolCategory: "filesystem" | "shell" | "edit" | "search" | "subagent" | "other";
	success: boolean;
	argsCaptured: false;
}

export interface SubagentAttributes extends Record<string, unknown> {
	agentName: string;
	success: boolean;
	inputTokens?: number;
	outputTokens?: number;
}

export interface ValidationAttributes extends Record<string, unknown> {
	validationKind: "check" | "focused-test" | "lint" | "typecheck" | "other";
	commandLabel: string;
	exitCode: number;
	success: boolean;
}

export interface ErrorAttributes extends Record<string, unknown> {
	component: string;
	errorClass: string;
	message?: string;
	stackHash?: string;
}

export interface EnvironmentAttributes extends Record<string, unknown> {
	os: string;
	arch: string;
	nodeVersion: string;
	terminalColumns?: number;
	terminalRows?: number;
	shellName?: string;
}

export type DiagnosticsEvent =
	| DiagnosticsEventEnvelope<"session.started" | "session.ended" | "session.crashed", SessionAttributes>
	| DiagnosticsEventEnvelope<"command.completed", CommandAttributes>
	| DiagnosticsEventEnvelope<"turn.ended", TurnAttributes>
	| DiagnosticsEventEnvelope<"model_request.completed", ModelRequestAttributes>
	| DiagnosticsEventEnvelope<"tool_call.completed", ToolCallAttributes>
	| DiagnosticsEventEnvelope<"subagent.completed", SubagentAttributes>
	| DiagnosticsEventEnvelope<"validation.completed", ValidationAttributes>
	| DiagnosticsEventEnvelope<"error.reported", ErrorAttributes>
	| DiagnosticsEventEnvelope<"environment.reported", EnvironmentAttributes>;

export type DiagnosticsFileName =
	| "sessions.jsonl"
	| "commands.jsonl"
	| "turns.jsonl"
	| "model-requests.jsonl"
	| "tool-calls.jsonl"
	| "subagents.jsonl"
	| "validation.jsonl"
	| "errors.jsonl"
	| "environment.jsonl";

export function fileNameForEvent(type: DiagnosticsEvent["type"]): DiagnosticsFileName {
	if (type.startsWith("session.")) return "sessions.jsonl";
	if (type.startsWith("command.")) return "commands.jsonl";
	if (type.startsWith("turn.")) return "turns.jsonl";
	if (type.startsWith("model_request.")) return "model-requests.jsonl";
	if (type.startsWith("tool_call.")) return "tool-calls.jsonl";
	if (type.startsWith("subagent.")) return "subagents.jsonl";
	if (type.startsWith("validation.")) return "validation.jsonl";
	if (type.startsWith("error.")) return "errors.jsonl";
	return "environment.jsonl";
}

export function createEnvelope<
	TType extends DiagnosticsEvent["type"],
	TAttributes extends Record<string, unknown>,
>(args: {
	sessionId: string;
	type: TType;
	source: DiagnosticsSource;
	attributes: TAttributes;
	durationMs?: number;
	outcome?: DiagnosticsOutcome;
}): DiagnosticsEventEnvelope<TType, TAttributes> {
	return {
		schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
		eventSchemaVersion: DIAGNOSTICS_EVENT_SCHEMA_VERSION,
		eventId: randomUUID(),
		sessionId: args.sessionId,
		timestamp: new Date().toISOString(),
		type: args.type,
		source: args.source,
		...(args.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(args.durationMs)) } : {}),
		...(args.outcome ? { outcome: args.outcome } : {}),
		attributes: args.attributes,
	};
}
