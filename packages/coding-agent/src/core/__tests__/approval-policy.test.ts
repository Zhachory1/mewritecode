/**
 * Unit tests for the pure approval-policy classifier (#14).
 *
 * The classifier is the core of the OPT-IN "honest approval speed-bump". It maps
 * a tool call to a risk tier so the approval gate can decide whether to prompt.
 *
 * HONEST POSITIONING (tested as intent, not just behavior): the destructive-bash
 * detection is a best-effort HEURISTIC for SURFACING risk to a human, NOT a
 * security boundary. These tests deliberately document the known bypasses
 * (eval/$()/base64 etc.) — they classify as `exec` (not `destructive`) but STILL
 * need approval, which is the safe outcome. If a future change made any of those
 * "read"/no-approval, these tests fail loudly.
 */

import { describe, expect, it } from "vitest";
import { classifyToolCall, needsApproval, type RiskTier } from "../approval-policy.js";

describe("classifyToolCall — read-only tools", () => {
	it.each(["read", "grep", "find", "ls"])("classifies %s as read", (name) => {
		expect(classifyToolCall(name, {})).toBe("read");
	});

	it("is case-insensitive for tool names", () => {
		expect(classifyToolCall("Read", {})).toBe("read");
		expect(classifyToolCall("GREP", {})).toBe("read");
	});

	it("treats read-family tools as read regardless of args", () => {
		expect(classifyToolCall("read", { path: "/etc/passwd" })).toBe("read");
	});

	// LOW-4: clarify / task_status / memory_search are provably read-only and must
	// NOT be gated (clarify especially — gating it fires before the user can see
	// the question). They run free.
	it.each(["clarify", "task_status", "memory_search"])(
		"classifies provably-read-only tool %s as read (no double-gate)",
		(name) => {
			const tier = classifyToolCall(name, {});
			expect(tier).toBe("read");
			expect(needsApproval(tier)).toBe(false);
		},
	);

	// LOW-4 guard: task/agent SPAWN writers, so they must stay gated (NOT read).
	it.each(["task", "agent"])("keeps writer-spawning tool %s gated (write, not read)", (name) => {
		const tier = classifyToolCall(name, {});
		expect(tier).toBe("write");
		expect(needsApproval(tier)).toBe(true);
	});
});

describe("classifyToolCall — write tools", () => {
	it.each(["edit", "write"])("classifies %s as write", (name) => {
		expect(classifyToolCall(name, { path: "x", content: "y" })).toBe("write");
	});
});

describe("classifyToolCall — bash / exec", () => {
	it("classifies a benign bash command as exec", () => {
		expect(classifyToolCall("bash", { command: "echo hi" })).toBe("exec");
	});

	it("classifies bash with no command string as exec (conservative)", () => {
		expect(classifyToolCall("bash", {})).toBe("exec");
	});

	it.each([
		["rm -rf /", "rm -rf"],
		["rm  -rf   node_modules", "rm -rf (whitespace variant)"],
		["rm -fr build", "rm -fr flag order"],
		["git push --force origin main", "force push (long flag)"],
		["git push -f origin main", "force push (short flag)"],
		["git push --force-with-lease", "force-with-lease"],
		["git reset --hard HEAD~3", "git reset --hard"],
		["psql -c 'DROP TABLE users'", "DROP TABLE"],
		["mysql -e 'truncate table sessions'", "TRUNCATE (lowercase)"],
		["echo x && rm -rf /tmp/y", "destructive after &&"],
	])("flags destructive bash: %s", (command) => {
		expect(classifyToolCall("bash", { command })).toBe("destructive");
	});

	it("does not over-flag benign commands containing substrings", () => {
		// "performance" contains "rm" but is not rm -rf; "address" not relevant.
		expect(classifyToolCall("bash", { command: "npm run perform" })).toBe("exec");
		expect(classifyToolCall("bash", { command: "echo 'droperations'" })).toBe("exec");
	});

	// --- KNOWN-NOT-CAUGHT bypasses (documented, intentionally still safe) ---
	// These hide the dangerous op from the destructive HEURISTIC (no literal
	// `rm -rf` / `DROP` / force-push token survives), so they classify as `exec`,
	// NOT `destructive`. The safe outcome still holds: `exec` needs approval. The
	// point of these tests is to PIN that the heuristic is NOT relied on for
	// safety — a human still reviews. (`eval 'rm -rf /'` and `$(echo "rm -rf /")`
	// are deliberately NOT in this list: they carry the literal pattern, so the
	// heuristic does surface them as destructive — also a safe outcome.)
	it.each([
		"echo cm0gLXJmIC8= | base64 -d | sh",
		"python -c \"import shutil; shutil.rmtree('/')\"",
		"npm run nuke",
		"alias x='rm'; x -rrf /tmp/z".replace("rrf", "fr-not-a-flag"),
		'node -e \'require("fs").rmSync("/",{recursive:true})\'',
	])("known bypass %s classifies as exec (NOT destructive) but still needs approval", (command) => {
		const tier = classifyToolCall("bash", { command });
		expect(tier).toBe("exec");
		expect(needsApproval(tier)).toBe(true);
	});
});

describe("classifyToolCall — conservative-unknown", () => {
	it.each(["mcp__github__create_issue", "some_custom_tool", "webfetch", ""])(
		"classifies unknown/custom/MCP tool %s as write (needs approval)",
		(name) => {
			expect(classifyToolCall(name, {})).toBe("write");
		},
	);

	it("treats a null/undefined args payload safely (still classifies by name)", () => {
		expect(classifyToolCall("read", undefined)).toBe("read");
		expect(classifyToolCall("bash", null)).toBe("exec");
		expect(classifyToolCall("mystery", null)).toBe("write");
	});
});

describe("needsApproval", () => {
	it("only read is free", () => {
		expect(needsApproval("read")).toBe(false);
	});

	it.each<RiskTier>(["write", "exec", "destructive"])("requires approval for %s", (tier) => {
		expect(needsApproval(tier)).toBe(true);
	});
});
