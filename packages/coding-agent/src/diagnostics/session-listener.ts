import type { AssistantMessage } from "@zhachory1/mewrite-ai";
import type { AgentSession, AgentSessionEvent } from "../core/agent-session.js";
import type { DiagnosticsRecorder } from "./recorder.js";

function toolCategory(toolName: string): "filesystem" | "shell" | "edit" | "search" | "subagent" | "other" {
	if (toolName === "bash") return "shell";
	if (toolName === "edit" || toolName === "write" || toolName.includes("edit")) return "edit";
	if (toolName === "read" || toolName === "ls") return "filesystem";
	if (toolName === "grep" || toolName === "find") return "search";
	if (toolName === "task" || toolName === "agent") return "subagent";
	return "other";
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
	return typeof message === "object" && message !== null && "role" in message && message.role === "assistant";
}

function numberAttr(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringAttr(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function slashCommandFromMessage(message: unknown): string | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	if (!("role" in message) || message.role !== "user") return undefined;
	if (!("content" in message)) return undefined;
	const content = message.content;
	let text = "";
	if (typeof content === "string") {
		text = content;
	} else if (Array.isArray(content)) {
		const firstText = content.find(
			(part): part is { type: string; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string",
		);
		text = firstText?.text ?? "";
	}
	const match = text.trim().match(/^\/([a-zA-Z0-9:_-]+)/);
	return match ? `/${match[1]}` : undefined;
}

function exitCodeFromResult(result: unknown): number | undefined {
	if (typeof result !== "object" || result === null) return undefined;
	if (!("details" in result)) return undefined;
	const details = result.details;
	if (typeof details !== "object" || details === null) return undefined;
	if (!("exitCode" in details)) return undefined;
	return numberAttr(details.exitCode);
}

function validationKindFromTool(toolName: string): "check" | "focused-test" | "lint" | "typecheck" | "other" {
	if (toolName !== "bash") return "other";
	return "other";
}

export function attachDiagnosticsSessionListener(session: AgentSession, recorder: DiagnosticsRecorder): () => void {
	const toolStarts = new Map<string, { startedAt: number; toolName: string }>();
	const assistantStarts = new Map<string, number>();
	const subagentStarts = new Map<string, { startedAt: number; agentName: string }>();

	return session.subscribe((event: AgentSessionEvent) => {
		try {
			if (event.type === "message_end") {
				const slashCommand = slashCommandFromMessage(event.message);
				if (slashCommand) {
					recorder.commandCompleted({ commandName: slashCommand, commandKind: "slash", success: true }, 0);
				}
			}
			if (event.type === "tool_execution_start") {
				toolStarts.set(event.toolCallId, { startedAt: Date.now(), toolName: event.toolName });
				return;
			}
			if (event.type === "tool_execution_end") {
				const started = toolStarts.get(event.toolCallId);
				toolStarts.delete(event.toolCallId);
				const durationMs = started ? Date.now() - started.startedAt : 0;
				recorder.toolCallCompleted(
					{
						toolName: event.toolName,
						toolCategory: toolCategory(event.toolName),
						success: !event.isError,
						argsCaptured: false,
					},
					durationMs,
				);
				const exitCode = exitCodeFromResult(event.result);
				if (event.toolName === "bash" && exitCode !== undefined) {
					recorder.validationCompleted(
						{
							validationKind: validationKindFromTool(event.toolName),
							commandLabel: "bash",
							exitCode,
							success: exitCode === 0 && !event.isError,
						},
						durationMs,
					);
				}
				return;
			}
			if (event.type === "subagent_progress") {
				if (event.phase === "started") {
					subagentStarts.set(event.subagentId, { startedAt: event.timestamp, agentName: event.subagentName });
				} else if (event.phase === "completed" || event.phase === "failed") {
					const started = subagentStarts.get(event.subagentId);
					subagentStarts.delete(event.subagentId);
					recorder.subagentCompleted(
						{
							agentName: started?.agentName ?? event.subagentName,
							success: event.phase === "completed",
						},
						started ? event.timestamp - started.startedAt : 0,
					);
				}
				return;
			}
			if (event.type === "message_start" && event.message.role === "assistant") {
				assistantStarts.set(String(event.message.timestamp), Date.now());
				return;
			}
			if (event.type === "message_end" && isAssistantMessage(event.message)) {
				const startedAt = assistantStarts.get(String(event.message.timestamp));
				assistantStarts.delete(String(event.message.timestamp));
				recorder.modelRequestCompleted(
					{
						provider: event.message.provider,
						model: event.message.model,
						inputTokens: numberAttr(event.message.usage.input),
						outputTokens: numberAttr(event.message.usage.output),
						cacheReadTokens: numberAttr(event.message.usage.cacheRead),
						cacheWriteTokens: numberAttr(event.message.usage.cacheWrite),
						stopReason: stringAttr(event.message.stopReason),
						retryCount: 0,
						...(event.message.stopReason === "error" ? { errorClass: "ModelError" } : {}),
					},
					startedAt ? Date.now() - startedAt : 0,
					event.message.stopReason === "error" ? "error" : "ok",
				);
				if (event.message.stopReason === "error") {
					recorder.errorReported({
						component: "model-request",
						errorClass: "ModelError",
						message: event.message.errorMessage,
					});
				}
			}
		} catch {
			return;
		}
	});
}
