import type { SettingsManager } from "../core/settings-manager.js";
import {
	type CommandAttributes,
	createEnvelope,
	type DiagnosticsEvent,
	type DiagnosticsOutcome,
	type EnvironmentAttributes,
	type ErrorAttributes,
	type ModelRequestAttributes,
	type SessionAttributes,
	type SubagentAttributes,
	type ToolCallAttributes,
	type ValidationAttributes,
} from "./events.js";
import { hasSensitiveKey, type RedactionConfig, redactForDiagnostics } from "./redaction.js";
import { appendDiagnosticsEvent, diagnosticsEnabled, rotateDiagnostics } from "./store.js";

export interface DiagnosticsRecorderOptions {
	agentDir: string;
	sessionId: string;
	settingsManager: SettingsManager;
	redaction?: RedactionConfig;
}

export interface DiagnosticsRecorder {
	sessionStarted(attributes: SessionAttributes): void;
	sessionEnded(attributes: SessionAttributes, durationMs?: number): void;
	commandCompleted(attributes: CommandAttributes, durationMs: number): void;
	modelRequestCompleted(attributes: ModelRequestAttributes, durationMs: number, outcome?: DiagnosticsOutcome): void;
	toolCallCompleted(attributes: ToolCallAttributes, durationMs: number): void;
	subagentCompleted(attributes: SubagentAttributes, durationMs: number): void;
	validationCompleted(attributes: ValidationAttributes, durationMs: number): void;
	errorReported(attributes: ErrorAttributes): void;
	environmentReported(attributes: EnvironmentAttributes): void;
	flush(): Promise<void>;
}

function dropSensitiveFields<T extends Record<string, unknown>>(attributes: T, redaction: RedactionConfig): T {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (hasSensitiveKey(key, redaction)) continue;
		out[key] = value;
	}
	return out as T;
}

export function createDiagnosticsRecorder(options: DiagnosticsRecorderOptions): DiagnosticsRecorder {
	const redaction = options.redaction ?? options.settingsManager.getDiagnosticsRedactionConfig();

	function record<TType extends DiagnosticsEvent["type"], TAttributes extends Record<string, unknown>>(
		type: TType,
		attributes: TAttributes,
		durationMs?: number,
		outcome?: DiagnosticsOutcome,
	): void {
		try {
			if (!diagnosticsEnabled(options.settingsManager)) return;
			rotateDiagnostics(options.agentDir);
			const safeAttributes = redactForDiagnostics(dropSensitiveFields(attributes, redaction), redaction).value;
			const event = createEnvelope({
				sessionId: options.sessionId,
				type,
				source: "coding-agent",
				attributes: safeAttributes,
				durationMs,
				outcome,
			}) as unknown as DiagnosticsEvent;
			appendDiagnosticsEvent(options.agentDir, event);
		} catch {
			return;
		}
	}

	return {
		sessionStarted(attributes) {
			record("session.started", attributes, undefined, "ok");
		},
		sessionEnded(attributes, durationMs) {
			record("session.ended", attributes, durationMs, attributes.exitReason === "error" ? "error" : "ok");
		},
		commandCompleted(attributes, durationMs) {
			record("command.completed", attributes, durationMs, attributes.success ? "ok" : "error");
		},
		modelRequestCompleted(attributes, durationMs, outcome) {
			record("model_request.completed", attributes, durationMs, outcome ?? (attributes.errorClass ? "error" : "ok"));
		},
		toolCallCompleted(attributes, durationMs) {
			record("tool_call.completed", attributes, durationMs, attributes.success ? "ok" : "error");
		},
		subagentCompleted(attributes, durationMs) {
			record("subagent.completed", attributes, durationMs, attributes.success ? "ok" : "error");
		},
		validationCompleted(attributes, durationMs) {
			record("validation.completed", attributes, durationMs, attributes.success ? "ok" : "error");
		},
		errorReported(attributes) {
			record("error.reported", attributes, undefined, "error");
		},
		environmentReported(attributes) {
			record("environment.reported", attributes, undefined, "ok");
		},
		async flush() {
			return;
		},
	};
}
