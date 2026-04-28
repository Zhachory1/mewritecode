/**
 * Unit tests for HooksExecutor — exit-code semantics, JSON output parsing,
 * stdout-as-context, timeout enforcement, and the most-restrictive
 * permission combiner.
 *
 * These tests spawn real /bin/sh subprocesses, which is fast on macOS/Linux.
 * Skipped on Windows (CI doesn't currently run cave on Windows).
 */
import { describe, expect, it } from "vitest";
import { HooksExecutor, combineDecisions, type HookConfig } from "../src/core/hooks/index.js";

const skipOnWindows = process.platform === "win32" ? it.skip : it;

describe("HooksExecutor", () => {
	const baseStdin = {
		session_id: "test-session",
		cwd: process.cwd(),
		hook_event_name: "PreToolUse",
	};

	skipOnWindows("runs a command hook and captures stdout/stderr/exit", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = {
			type: "command",
			command: "echo hello-stdout; echo hello-stderr 1>&2; exit 0",
		};
		const result = await exec.runOne("PostToolUse", "Edit", hook, baseStdin);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello-stdout");
		expect(result.stderr.trim()).toBe("hello-stderr");
		expect(result.error).toBeUndefined();
	});

	skipOnWindows("PreToolUse exit 2 is treated as deny", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = { type: "command", command: 'echo "blocked" 1>&2; exit 2' };
		const result = await exec.runOne("PreToolUse", "Bash", hook, baseStdin);
		expect(result.exitCode).toBe(2);
		expect(result.permission).toBe("deny");
		expect(result.additionalContext).toContain("blocked");
	});

	skipOnWindows("PreToolUse JSON envelope drives permissionDecision", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = {
			type: "command",
			command: `cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"confirm please"}}
JSON
`,
		};
		const result = await exec.runOne("PreToolUse", "Bash", hook, baseStdin);
		expect(result.exitCode).toBe(0);
		expect(result.permission).toBe("ask");
		expect(result.parsedOutput?.hookSpecificOutput?.permissionDecisionReason).toBe("confirm please");
	});

	skipOnWindows("legacy `decision: 'block'` shorthand becomes deny", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = {
			type: "command",
			command: `echo '{"decision":"block","reason":"nope"}'`,
		};
		const result = await exec.runOne("PreToolUse", "Bash", hook, baseStdin);
		expect(result.exitCode).toBe(0);
		expect(result.permission).toBe("deny");
	});

	skipOnWindows("UserPromptSubmit treats stdout-as-context", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = { type: "command", command: 'echo "Project rule: prefer functional style"' };
		const result = await exec.runOne("UserPromptSubmit", undefined, hook, {
			...baseStdin,
			hook_event_name: "UserPromptSubmit",
			prompt: "anything",
		} as any);
		expect(result.exitCode).toBe(0);
		expect(result.additionalContext).toContain("Project rule");
	});

	skipOnWindows(
		"times out a slow hook and reports timedOut",
		async () => {
			const exec = new HooksExecutor();
			const hook: HookConfig = {
				type: "command",
				command: "sleep 5",
				timeout: 1, // 1 second
			};
			const start = Date.now();
			const result = await exec.runOne("PostToolUse", "Edit", hook, baseStdin);
			const dur = Date.now() - start;
			expect(result.timedOut).toBe(true);
			expect(dur).toBeLessThan(4000);
		},
		10000,
	);

	skipOnWindows("dispatch short-circuits on deny for PreToolUse", async () => {
		const exec = new HooksExecutor();
		const matched = [
			{
				event: "PreToolUse",
				matcher: "Bash",
				hook: { type: "command" as const, command: "exit 2" },
				scope: "project" as const,
			},
			{
				event: "PreToolUse",
				matcher: "Bash",
				hook: { type: "command" as const, command: "echo allow" },
				scope: "project" as const,
			},
		];
		const out = await exec.dispatch("PreToolUse", "Bash", matched, baseStdin);
		expect(out.permission).toBe("deny");
		expect(out.results).toHaveLength(1); // second hook never ran
	});

	skipOnWindows("non-command hook types are accepted but skipped in v1", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = { type: "http", url: "http://localhost:9999/never" };
		const result = await exec.runOne("PreToolUse", "Bash", hook, baseStdin);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain("not yet implemented");
	});

	skipOnWindows("stdin payload is forwarded as JSON to the hook process", async () => {
		const exec = new HooksExecutor();
		const hook: HookConfig = {
			type: "command",
			command: "cat", // echoes stdin to stdout
		};
		const result = await exec.runOne("PreToolUse", "Bash", hook, {
			...baseStdin,
			tool_name: "Bash",
			tool_input: { command: "ls" },
		} as any);
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout);
		expect(parsed.tool_name).toBe("Bash");
		expect(parsed.tool_input.command).toBe("ls");
		expect(parsed.session_id).toBe("test-session");
		expect(parsed.hook_event_name).toBe("PreToolUse");
	});
});

describe("combineDecisions", () => {
	it("picks the most restrictive permission", () => {
		expect(combineDecisions(["allow", "ask"])).toBe("ask");
		expect(combineDecisions(["allow", "ask", "deny"])).toBe("deny");
		expect(combineDecisions(["allow", "allow"])).toBe("allow");
		expect(combineDecisions([undefined, undefined])).toBeUndefined();
		expect(combineDecisions(["defer", "allow"])).toBe("defer");
	});
});
