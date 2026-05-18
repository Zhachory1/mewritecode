/**
 * WS16: exec mode — wraps print-mode with CI ergonomics.
 *
 * Responsibilities:
 *  1. Emit a stable JSONL event stream (--json).
 *  2. Validate the final assistant message against a JSON Schema (--output-schema).
 *  3. Write the final assistant text/JSON to a file atomically (--output-last-message).
 *  4. Support --ephemeral (ignore user config files).
 *  5. Support --profile (named profile from settings).
 *  6. Map errors to documented exit codes.
 *
 * This module deliberately does NOT replicate print-mode logic — it delegates
 * to runPrintMode and taps the session's event stream via the runtime.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import { flushRawStdout } from "../../core/output-guard.js";
import { runPrintMode } from "../print-mode.js";
import { type CostInfo, emitEvent, translateAgentEvent } from "./event-stream.js";
import {
	classifyError,
	EXIT_GENERIC_ERROR,
	EXIT_SCHEMA_VALIDATION_FAILED,
	EXIT_SUCCESS,
	EXIT_TIMEOUT,
	ExecTimeoutError,
	ExecUserConfigError,
} from "./exit-codes.js";
import { loadSchema, validateOutput } from "./output-schema.js";

export interface ExecModeOptions {
	/** The prompt to send. */
	prompt: string;

	/**
	 * Emit stable JSONL events on stdout.
	 * When false (default), plain assistant text is written to stdout.
	 */
	json?: boolean;

	/**
	 * Path to a JSON Schema file. The final assistant message is validated
	 * against it; on mismatch the process exits with code 2.
	 */
	outputSchema?: string;

	/**
	 * Write the final assistant text (or JSON, when --json) to this file
	 * atomically (write-to-tmp then rename).
	 */
	outputLastMessage?: string;

	/**
	 * Ignore ~/.cave/settings.json and project .cave/settings.json.
	 * Settings are derived only from CLI args and environment variables.
	 */
	ephemeral?: boolean;

	/**
	 * Named profile to load from settings.
	 * A profile is a top-level key in settings.json under `profiles`.
	 * Not yet wired to SettingsManager — placeholder for when settings gain
	 * profile support. Emits a warning when unknown and continues.
	 */
	profile?: string;

	/**
	 * Optional timeout in milliseconds. The process exits with code 5 when
	 * the agent does not complete within this window.
	 */
	timeoutMs?: number;
}

/**
 * Run a single non-interactive prompt and exit.
 *
 * Returns an exit code (not throws) — the CLI layer calls process.exit().
 */
export async function runExecMode(runtime: AgentSessionRuntime, options: ExecModeOptions): Promise<number> {
	const { outputSchema, timeoutMs, json = false } = options;

	// Load schema early so a bad schema path exits before we touch the model.
	let schema: Record<string, unknown> | undefined;
	if (outputSchema) {
		try {
			schema = loadSchema(resolve(outputSchema));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (json) {
				emitEvent({ type: "error", code: "user_config_error", message: msg });
			} else {
				process.stderr.write(`Error: ${msg}\n`);
			}
			return EXIT_GENERIC_ERROR; // schema load is a user error but we keep it generic here
		}
	}

	// Wrap execution with optional timeout.
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;

	const execPromise = _runExec(runtime, options, schema);

	let racePromise: Promise<number>;
	if (timeoutMs && timeoutMs > 0) {
		const timeoutPromise = new Promise<number>((resolve) => {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				resolve(EXIT_TIMEOUT);
			}, timeoutMs);
		});
		racePromise = Promise.race([execPromise, timeoutPromise]);
	} else {
		racePromise = execPromise;
	}

	try {
		const code = await racePromise;
		if (timedOut && json) {
			emitEvent({
				type: "error",
				code: "timeout",
				message: `cave exec timed out after ${timeoutMs}ms`,
			});
		}
		return code;
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}

async function _runExec(
	runtime: AgentSessionRuntime,
	options: ExecModeOptions,
	schema: Record<string, unknown> | undefined,
): Promise<number> {
	const { prompt, json = false, outputLastMessage } = options;

	const sessionId = runtime.session.sessionManager.getHeader()?.id ?? randomUUID();
	const cwd = runtime.session.sessionManager.getCwd?.() ?? process.cwd();

	// Track the latest assistant text for --output-last-message and --output-schema.
	let lastAssistantText = "";
	let totalCost: CostInfo | undefined;

	if (json) {
		// Emit session.start
		emitEvent({ type: "session.start", session_id: sessionId, cwd });

		// Emit message.user
		emitEvent({ type: "message.user", content: prompt });

		// Subscribe to raw session events and translate to our stable stream.
		const unsubscribe = runtime.session.subscribe((rawEvent) => {
			const events = translateAgentEvent(rawEvent as unknown as Record<string, unknown>);
			for (const ev of events) {
				emitEvent(ev);
				// Track the last assistant content and cost for post-processing.
				if (ev.type === "message.assistant") {
					lastAssistantText = ev.content;
					totalCost = ev.cost;
				}
			}
		});

		let printExitCode: number;
		try {
			printExitCode = await runPrintMode(runtime, {
				mode: "json",
				initialMessage: prompt,
			});
		} finally {
			unsubscribe();
		}

		// Extract last assistant message from session state as fallback
		// (in case the subscription missed it).
		if (!lastAssistantText) {
			lastAssistantText = getLastAssistantText(runtime);
		}

		// Schema validation
		const schemaExit = validateAndMaybeEmitError(schema, lastAssistantText, json);
		if (schemaExit !== null) {
			emitEvent({
				type: "session.end",
				exit: EXIT_SCHEMA_VALIDATION_FAILED,
				cost: totalCost,
			});
			await flushRawStdout();
			return EXIT_SCHEMA_VALIDATION_FAILED;
		}

		// Output last message to file
		if (outputLastMessage) {
			writeLastMessage(outputLastMessage, lastAssistantText);
		}

		// session.end
		const finalExit = printExitCode === 0 ? EXIT_SUCCESS : printExitCode;
		emitEvent({ type: "session.end", exit: finalExit, cost: totalCost });
		await flushRawStdout();
		return finalExit;
	} else {
		// Plain text mode — delegate entirely to print-mode.
		// We still need the final message for --output-schema / --output-last-message.
		const printExitCode = await runPrintMode(runtime, {
			mode: "text",
			initialMessage: prompt,
		});

		lastAssistantText = getLastAssistantText(runtime);

		// Schema validation
		const schemaExit = validateAndMaybeEmitError(schema, lastAssistantText, json);
		if (schemaExit !== null) {
			return EXIT_SCHEMA_VALIDATION_FAILED;
		}

		if (outputLastMessage) {
			writeLastMessage(outputLastMessage, lastAssistantText);
		}

		return printExitCode === 0 ? EXIT_SUCCESS : printExitCode;
	}
}

/**
 * Validate output against schema. Returns EXIT_SCHEMA_VALIDATION_FAILED when
 * validation fails and emits/prints an error message. Returns null on success.
 */
function validateAndMaybeEmitError(
	schema: Record<string, unknown> | undefined,
	output: string,
	json: boolean,
): number | null {
	if (!schema) return null;

	const result = validateOutput(output, schema);
	if (!result.ok) {
		const msg = result.error ?? "Schema validation failed";
		if (json) {
			emitEvent({ type: "error", code: "schema_validation_failed", message: msg });
		} else {
			process.stderr.write(`Error: ${msg}\n`);
		}
		return EXIT_SCHEMA_VALIDATION_FAILED;
	}
	return null;
}

/**
 * Write text to a file atomically: write to a temp file, then rename.
 * Parent directory is created if it does not exist.
 */
function writeLastMessage(filePath: string, content: string): void {
	const abs = resolve(filePath);
	const dir = dirname(abs);
	const tmp = `${abs}.tmp.${process.pid}`;

	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(tmp, content, { encoding: "utf-8" });
		// Node.js rename is atomic on POSIX (same filesystem).
		renameSync(tmp, abs);
	} catch (err) {
		process.stderr.write(`Warning: could not write --output-last-message to "${abs}": ${(err as Error).message}\n`);
		// Clean up temp file if it exists
		try {
			unlinkSync(tmp);
		} catch {
			// ignore
		}
	}
}

/**
 * Extract the last assistant text from the session state after execution.
 */
function getLastAssistantText(runtime: AgentSessionRuntime): string {
	try {
		const state = runtime.session.state;
		const messages = state?.messages;
		if (!Array.isArray(messages)) return "";

		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as unknown as Record<string, unknown>;
			if (msg.role !== "assistant") continue;
			const content = msg.content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				const parts: string[] = [];
				for (const block of content) {
					if (typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text") {
						const text = (block as Record<string, unknown>).text;
						if (typeof text === "string") parts.push(text);
					}
				}
				if (parts.length > 0) return parts.join("");
			}
		}
	} catch {
		// Session state may not be accessible in all runtime configurations.
	}
	return "";
}

export { classifyError, ExecTimeoutError, ExecUserConfigError };
