/**
 * Unit tests for HooksRegistry — Claude Code-format settings.json parsing,
 * matcher resolution, and `once` semantics.
 */
import { describe, expect, it } from "vitest";
import { HooksRegistry } from "../src/core/hooks/registry.js";

const PROJECT = "project" as const;
const GLOBAL = "global" as const;

describe("HooksRegistry", () => {
	it("accepts a verbatim Claude Code v2.1.119 hooks block", () => {
		const r = new HooksRegistry();
		// This block was lifted from the published Claude Code docs.
		r.setLayer(PROJECT, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							if: "Bash(rm *)",
							command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/block-rm.sh',
							timeout: 5,
						},
					],
				},
			],
			PostToolUse: [
				{
					matcher: "Edit|Write",
					hooks: [{ type: "command", command: "/path/to/lint-check.sh" }],
				},
			],
			SessionStart: [
				{
					matcher: "startup",
					hooks: [
						{
							type: "mcp_tool",
							server: "my_server",
							tool: "get_context",
							timeout: 30,
						},
					],
				},
			],
		});
		const issues = r.getIssues();
		// mcp_tool isn't validated as failing — accepted for forward compat.
		expect(issues.filter((i) => i.message.toLowerCase().includes("must"))).toHaveLength(0);
		expect(r.summarize()).toHaveLength(3);
	});

	it("resolves PreToolUse hooks when the tool name matches the regex", () => {
		const r = new HooksRegistry();
		r.setLayer(PROJECT, {
			PreToolUse: [
				{
					matcher: "Edit|Write",
					hooks: [{ type: "command", command: "echo edit" }],
				},
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "echo bash" }],
				},
			],
		});
		expect(r.resolve("PreToolUse", "Bash")).toHaveLength(1);
		expect(r.resolve("PreToolUse", "Edit")).toHaveLength(1);
		expect(r.resolve("PreToolUse", "Write")).toHaveLength(1);
		// "BashTool" should not match "Bash" — anchored regex.
		expect(r.resolve("PreToolUse", "BashTool")).toHaveLength(0);
	});

	it("`*` and missing matcher both match everything", () => {
		const r = new HooksRegistry();
		r.setLayer(PROJECT, {
			Stop: [{ hooks: [{ type: "command", command: "true" }] }],
			Notification: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }],
		});
		expect(r.resolve("Stop", undefined)).toHaveLength(1);
		expect(r.resolve("Notification", "permission_prompt")).toHaveLength(1);
	});

	it("respects `once: true` across resolves", () => {
		const r = new HooksRegistry();
		r.setLayer(PROJECT, {
			SessionStart: [
				{
					hooks: [{ type: "command", command: "echo init", once: true }],
				},
			],
		});
		const first = r.resolve("SessionStart", "startup");
		expect(first).toHaveLength(1);
		// markFired must be invoked manually by caller (Manager does this).
		r.markFired(first[0].hook);
		expect(r.resolve("SessionStart", "startup")).toHaveLength(0);
		r.resetSession();
		expect(r.resolve("SessionStart", "startup")).toHaveLength(1);
	});

	it("disableAllHooks short-circuits resolution", () => {
		const r = new HooksRegistry({ disableAllHooks: true });
		r.setLayer(PROJECT, {
			PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }],
		});
		expect(r.resolve("PreToolUse", "Bash")).toHaveLength(0);
		r.setDisabled(false);
		expect(r.resolve("PreToolUse", "Bash")).toHaveLength(1);
	});

	it("rejects a malformed hooks entry but keeps siblings", () => {
		const r = new HooksRegistry();
		r.setLayer(PROJECT, {
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command" /* missing command */ }] },
				{ matcher: "Edit", hooks: [{ type: "command", command: "echo ok" }] },
			],
		});
		expect(r.getIssues().some((i) => i.message.includes("requires 'command'"))).toBe(true);
		expect(r.resolve("PreToolUse", "Edit")).toHaveLength(1);
		expect(r.resolve("PreToolUse", "Bash")).toHaveLength(0);
	});

	it("layers project on top of global, both visible in summarize()", () => {
		const r = new HooksRegistry();
		r.setLayer(GLOBAL, {
			Stop: [{ hooks: [{ type: "command", command: "echo from-global" }] }],
		});
		r.setLayer(PROJECT, {
			Stop: [{ hooks: [{ type: "command", command: "echo from-project" }] }],
		});
		const matches = r.resolve("Stop", undefined);
		expect(matches).toHaveLength(2);
		expect(matches.map((m) => m.scope).sort()).toEqual(["global", "project"]);
	});

	it("preserves unknown Claude Code event names for forward compat", () => {
		const r = new HooksRegistry();
		r.setLayer(PROJECT, {
			UserPromptExpansion: [{ hooks: [{ type: "command", command: "true" }] }],
		});
		// Cave doesn't fire UserPromptExpansion yet — but it isn't a parse error.
		expect(r.summarize()).toHaveLength(1);
		expect(r.getIssues()[0]?.message).toContain("not currently fired by cave");
	});
});
