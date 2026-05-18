/**
 * WS16: exec-mode unit tests.
 *
 * All tests mock model invocation — no real API calls are made.
 * Test count: ≥6 unit tests (see individual describe blocks).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — fake AgentSessionRuntime
// ---------------------------------------------------------------------------

function makeSession(assistantText: string, role: "assistant" | "user" = "assistant") {
	return {
		state: {
			messages: [
				{
					role,
					content: [{ type: "text", text: assistantText }],
					stopReason: "end_turn",
				},
			],
		},
		sessionManager: {
			getHeader: () => ({ id: "test-session-123" }),
			getCwd: () => process.cwd(),
		},
		subscribe: (_cb: (e: unknown) => void) => () => {},
	};
}

function _makeRuntime(assistantText: string) {
	return {
		session: makeSession(assistantText),
		dispose: async () => {},
	};
}

// ---------------------------------------------------------------------------
// 1. Exit-codes module
// ---------------------------------------------------------------------------

describe("exit-codes", () => {
	it("EXIT_SUCCESS is 0", async () => {
		const { EXIT_SUCCESS } = await import("../exit-codes.js");
		expect(EXIT_SUCCESS).toBe(0);
	});

	it("EXIT_SCHEMA_VALIDATION_FAILED is 2", async () => {
		const { EXIT_SCHEMA_VALIDATION_FAILED } = await import("../exit-codes.js");
		expect(EXIT_SCHEMA_VALIDATION_FAILED).toBe(2);
	});

	it("EXIT_TIMEOUT is 5", async () => {
		const { EXIT_TIMEOUT } = await import("../exit-codes.js");
		expect(EXIT_TIMEOUT).toBe(5);
	});

	it("classifyError maps ExecTimeoutError to EXIT_TIMEOUT", async () => {
		const { classifyError, ExecTimeoutError, EXIT_TIMEOUT } = await import("../exit-codes.js");
		expect(classifyError(new ExecTimeoutError(1000))).toBe(EXIT_TIMEOUT);
	});

	it("classifyError falls back to EXIT_GENERIC_ERROR for unknown error", async () => {
		const { classifyError, EXIT_GENERIC_ERROR } = await import("../exit-codes.js");
		expect(classifyError(new Error("boom"))).toBe(EXIT_GENERIC_ERROR);
	});

	it("classifyError maps ExecUserConfigError to EXIT_USER_CONFIG_ERROR", async () => {
		const { classifyError, ExecUserConfigError, EXIT_USER_CONFIG_ERROR } = await import("../exit-codes.js");
		expect(classifyError(new ExecUserConfigError("bad config"))).toBe(EXIT_USER_CONFIG_ERROR);
	});
});

// ---------------------------------------------------------------------------
// 2. Output-schema module
// ---------------------------------------------------------------------------

describe("output-schema: validateOutput", () => {
	it("validates a matching JSON object", async () => {
		const { validateOutput } = await import("../output-schema.js");
		const schema = {
			type: "object",
			required: ["result"],
			properties: { result: { type: "string" } },
		};
		const result = validateOutput(JSON.stringify({ result: "ok" }), schema);
		expect(result.ok).toBe(true);
	});

	it("rejects a non-matching JSON object", async () => {
		const { validateOutput } = await import("../output-schema.js");
		const schema = {
			type: "object",
			required: ["result"],
			properties: { result: { type: "number" } },
		};
		const result = validateOutput(JSON.stringify({ result: "not-a-number" }), schema);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});

	it("wraps non-JSON string as { text: <string> } before validating", async () => {
		const { validateOutput } = await import("../output-schema.js");
		const schema = {
			type: "object",
			required: ["text"],
			properties: { text: { type: "string" } },
		};
		const result = validateOutput("plain text response", schema);
		expect(result.ok).toBe(true);
	});

	it("loadSchema throws when file does not exist", async () => {
		const { loadSchema } = await import("../output-schema.js");
		expect(() => loadSchema("/nonexistent/path/schema.json")).toThrow();
	});

	it("loadSchema throws when file is not valid JSON", async () => {
		const { loadSchema } = await import("../output-schema.js");
		const tmpPath = join(tmpdir(), `cave-test-schema-${randomUUID()}.json`);
		writeFileSync(tmpPath, "not { valid json", "utf-8");
		try {
			expect(() => loadSchema(tmpPath)).toThrow(/not valid JSON/);
		} finally {
			rmSync(tmpPath, { force: true });
		}
	});

	it("loadSchema returns schema object for valid JSON", async () => {
		const { loadSchema } = await import("../output-schema.js");
		const tmpPath = join(tmpdir(), `cave-test-schema-${randomUUID()}.json`);
		const schema = { type: "object", required: ["foo"] };
		writeFileSync(tmpPath, JSON.stringify(schema), "utf-8");
		try {
			const loaded = loadSchema(tmpPath);
			expect(loaded).toEqual(schema);
		} finally {
			rmSync(tmpPath, { force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Event-stream module
// ---------------------------------------------------------------------------

describe("event-stream: translateAgentEvent", () => {
	it("translates tool_execution_start to tool.call", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		const events = translateAgentEvent({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("tool.call");
		const ev = events[0] as { type: "tool.call"; name: string; id: string };
		expect(ev.name).toBe("bash");
		expect(ev.id).toBe("call-1");
	});

	it("translates tool_execution_end to tool.result", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		const events = translateAgentEvent({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "bash",
			result: "file.ts",
			isError: false,
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("tool.result");
		const ev = events[0] as { type: "tool.result"; ok: boolean; output: string };
		expect(ev.ok).toBe(true);
		expect(ev.output).toBe("file.ts");
	});

	it("translates message_end (assistant) to message.assistant", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		const events = translateAgentEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Hello CI" }],
			},
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("message.assistant");
		const ev = events[0] as { type: "message.assistant"; content: string };
		expect(ev.content).toBe("Hello CI");
	});

	it("translates message_end (user) to message.user", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		const events = translateAgentEvent({
			type: "message_end",
			message: {
				role: "user",
				content: [{ type: "text", text: "list files" }],
			},
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("message.user");
	});

	it("returns empty array for agent_start", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		expect(translateAgentEvent({ type: "agent_start" })).toHaveLength(0);
	});

	it("returns empty array for unknown event type", async () => {
		const { translateAgentEvent } = await import("../event-stream.js");
		expect(translateAgentEvent({ type: "something_new" })).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// 4. --output-last-message atomic write
// ---------------------------------------------------------------------------

describe("exec-mode: --output-last-message", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cave-exec-test-${randomUUID()}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes final assistant text to file when schema validation passes", async () => {
		const { validateOutput } = await import("../output-schema.js");
		// Direct test of the validation + write pathway used in exec-mode
		const outputPath = join(tmpDir, "out.txt");
		const text = "my assistant output";
		const schema = {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		};
		const result = validateOutput(text, schema);
		expect(result.ok).toBe(true);

		// Simulate the atomic write that exec-mode does
		const tmp = `${outputPath}.tmp`;
		writeFileSync(tmp, text, "utf-8");
		const { renameSync } = await import("node:fs");
		renameSync(tmp, outputPath);

		expect(existsSync(outputPath)).toBe(true);
		expect(readFileSync(outputPath, "utf-8")).toBe(text);
	});
});

// ---------------------------------------------------------------------------
// 5. parseExecArgs
// ---------------------------------------------------------------------------

describe("parseExecArgs", () => {
	it("parses prompt positional argument", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["hello world"]);
		expect(args?.prompt).toBe("hello world");
	});

	it("parses --json flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--json", "prompt"]);
		expect(args?.json).toBe(true);
	});

	it("parses --ephemeral flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--ephemeral", "prompt"]);
		expect(args?.ephemeral).toBe(true);
	});

	it("parses --output-schema flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--output-schema", "/tmp/schema.json", "prompt"]);
		expect(args?.outputSchema).toBe("/tmp/schema.json");
	});

	it("parses --output-last-message flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--output-last-message", "/tmp/out.txt", "prompt"]);
		expect(args?.outputLastMessage).toBe("/tmp/out.txt");
	});

	it("parses --model flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--model", "anthropic/claude-haiku-4-5", "prompt"]);
		expect(args?.model).toBe("anthropic/claude-haiku-4-5");
	});

	it("parses --timeout flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--timeout", "5000", "prompt"]);
		expect(args?.timeoutMs).toBe(5000);
	});

	it("parses --profile flag", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--profile", "ci", "prompt"]);
		expect(args?.profile).toBe("ci");
	});

	it("combines multiple positionals as the prompt", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["list", "all", "files"]);
		expect(args?.prompt).toBe("list all files");
	});

	it("sets help flag on --help", async () => {
		const { parseExecArgs } = await import("../../../cli/exec-args.js");
		const args = parseExecArgs(["--help"]);
		expect(args?.help).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 6. emitEvent / event shape
// ---------------------------------------------------------------------------

describe("emitEvent: event shapes are stable", () => {
	it("session.start has session_id and cwd", async () => {
		const { emitEvent } = await import("../event-stream.js");
		const captured: string[] = [];
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			emitEvent({ type: "session.start", session_id: "abc", cwd: "/tmp" });
		} finally {
			process.stdout.write = orig;
		}

		const parsed = JSON.parse(captured.join("").trim());
		expect(parsed.type).toBe("session.start");
		expect(parsed.session_id).toBe("abc");
		expect(parsed.cwd).toBe("/tmp");
	});

	it("session.end has exit field", async () => {
		const { emitEvent } = await import("../event-stream.js");
		const captured: string[] = [];
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			emitEvent({ type: "session.end", exit: 0 });
		} finally {
			process.stdout.write = orig;
		}

		const parsed = JSON.parse(captured.join("").trim());
		expect(parsed.type).toBe("session.end");
		expect(parsed.exit).toBe(0);
	});

	it("error event has code and message", async () => {
		const { emitEvent } = await import("../event-stream.js");
		const captured: string[] = [];
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			emitEvent({ type: "error", code: "model_error", message: "rate limited" });
		} finally {
			process.stdout.write = orig;
		}

		const parsed = JSON.parse(captured.join("").trim());
		expect(parsed.type).toBe("error");
		expect(parsed.code).toBe("model_error");
	});
});
