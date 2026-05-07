// WS6: agent-defs loader tests.
//
// Verifies discovery from project + user + bundled scopes, frontmatter
// parsing for the WS6 superset (isolation, mcpServers, hooks, maxTurns,
// skills, effort, background, disallowedTools), and override semantics
// (project > user > builtin on name collision).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAgentDef, formatAgentList, loadAgentDefs, parseAgentDefFile } from "../src/core/agent-defs/loader.js";

let tmpRoot: string;
let cwd: string;
let userDir: string;
let packageDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cave-agent-defs-test-"));
	cwd = join(tmpRoot, "project");
	userDir = join(tmpRoot, "user-cave");
	packageDir = join(tmpRoot, "bundled-pkg");
	mkdirSync(join(cwd, ".cave", "agents"), { recursive: true });
	mkdirSync(join(userDir, "agents"), { recursive: true });
	mkdirSync(join(packageDir, "agents"), { recursive: true });
});

afterEach(() => {
	if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAgent(dir: string, name: string, frontmatter: Record<string, unknown>, body = "agent body"): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(frontmatter)) {
		if (Array.isArray(v)) {
			lines.push(`${k}:`);
			for (const item of v) lines.push(`  - ${item}`);
		} else if (typeof v === "object" && v !== null) {
			lines.push(`${k}: ${JSON.stringify(v)}`);
		} else {
			lines.push(`${k}: ${String(v)}`);
		}
	}
	lines.push("---", "", body);
	const filePath = join(dir, `${name}.md`);
	writeFileSync(filePath, lines.join("\n"));
	return filePath;
}

describe("parseAgentDefFile", () => {
	it("parses a minimal agent def", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "explore", {
			name: "explore",
			description: "scout",
		});
		const { def, diagnostics } = parseAgentDefFile(filePath, "project");
		expect(diagnostics).toEqual([]);
		expect(def?.name).toBe("explore");
		expect(def?.description).toBe("scout");
		expect(def?.prompt.trim()).toBe("agent body");
		expect(def?.source).toBe("project");
	});

	it("parses the full WS6 frontmatter superset", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "reviewer", {
			name: "reviewer",
			description: "critique",
			tools: ["read", "grep"],
			disallowedTools: ["bash"],
			model: "claude-sonnet-4-5",
			isolation: "worktree",
			mcpServers: ["github"],
			skills: ["caveman-compress"],
			maxTurns: 12,
			effort: "high",
			background: false,
			hooks: { PreToolUse: [{ command: "echo hi" }] },
		});
		const { def, diagnostics } = parseAgentDefFile(filePath, "project");
		expect(diagnostics).toEqual([]);
		expect(def?.tools).toEqual(["read", "grep"]);
		expect(def?.disallowedTools).toEqual(["bash"]);
		expect(def?.model).toBe("claude-sonnet-4-5");
		expect(def?.isolation).toBe("worktree");
		expect(def?.mcpServers).toEqual(["github"]);
		expect(def?.skills).toEqual(["caveman-compress"]);
		expect(def?.maxTurns).toBe(12);
		expect(def?.effort).toBe("high");
		expect(def?.background).toBe(false);
		expect(def?.hooks).toBeDefined();
	});

	it("accepts comma-separated string for tools (Claude Code compatibility)", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "scout", {
			name: "scout",
			description: "fast",
			tools: "read, grep, find",
		});
		const { def } = parseAgentDefFile(filePath, "project");
		expect(def?.tools).toEqual(["read", "grep", "find"]);
	});

	it("skips defs missing required fields", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "noname", {});
		const { def, diagnostics } = parseAgentDefFile(filePath, "project");
		expect(def).toBeNull();
		expect(diagnostics.some((d) => d.message === "description is required")).toBe(true);
	});

	it("derives name from filename when frontmatter omits it", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "infer-name", {
			description: "implicit",
		});
		const { def, diagnostics } = parseAgentDefFile(filePath, "project");
		expect(def?.name).toBe("infer-name");
		expect(diagnostics).toEqual([]);
	});

	it("preserves unknown frontmatter keys (CC passthrough)", () => {
		const filePath = writeAgent(join(cwd, ".cave", "agents"), "passthrough", {
			name: "passthrough",
			description: "unknown keys",
			"argument-hint": "<file>",
			"user-invocable": true,
			weirdFutureField: "value",
		});
		const { def } = parseAgentDefFile(filePath, "project");
		expect((def as any)?.["argument-hint"]).toBe("<file>");
		expect((def as any)?.["user-invocable"]).toBe(true);
		expect((def as any)?.weirdFutureField).toBe("value");
	});
});

describe("loadAgentDefs", () => {
	it("loads from project scope only when other scopes empty", () => {
		writeAgent(join(cwd, ".cave", "agents"), "alpha", {
			name: "alpha",
			description: "project",
		});
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		expect(result.agents.length).toBe(1);
		expect(result.agents[0].def.name).toBe("alpha");
		expect(result.agents[0].def.source).toBe("project");
	});

	it("loads from all three scopes (project + user + bundled)", () => {
		writeAgent(join(packageDir, "agents"), "builtin1", { name: "builtin1", description: "b" });
		writeAgent(join(userDir, "agents"), "user1", { name: "user1", description: "u" });
		writeAgent(join(cwd, ".cave", "agents"), "project1", { name: "project1", description: "p" });
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		const names = result.agents.map((a) => a.def.name).sort();
		expect(names).toEqual(["builtin1", "project1", "user1"]);
	});

	it("project scope overrides user and builtin on name collision", () => {
		writeAgent(join(packageDir, "agents"), "explore", { name: "explore", description: "builtin" });
		writeAgent(join(userDir, "agents"), "explore", { name: "explore", description: "user" });
		writeAgent(join(cwd, ".cave", "agents"), "explore", { name: "explore", description: "project" });
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].def.description).toBe("project");
		expect(result.agents[0].def.source).toBe("project");
	});

	it("user scope overrides builtin", () => {
		writeAgent(join(packageDir, "agents"), "explore", { name: "explore", description: "builtin" });
		writeAgent(join(userDir, "agents"), "explore", { name: "explore", description: "user" });
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].def.description).toBe("user");
		expect(result.agents[0].def.source).toBe("user");
	});

	it("respects skip flags", () => {
		writeAgent(join(packageDir, "agents"), "x", { name: "x", description: "b" });
		writeAgent(join(userDir, "agents"), "y", { name: "y", description: "u" });
		writeAgent(join(cwd, ".cave", "agents"), "z", { name: "z", description: "p" });
		const onlyProject = loadAgentDefs({ cwd, userDir, packageDir, skipBundled: true, skipUser: true });
		expect(onlyProject.agents.map((a) => a.def.name)).toEqual(["z"]);
	});

	it("loads extra plugin dirs", () => {
		const pluginDir = join(tmpRoot, "plugin", "agents");
		mkdirSync(pluginDir, { recursive: true });
		writeAgent(pluginDir, "plugin1", { name: "plugin1", description: "p" });
		const result = loadAgentDefs({
			cwd,
			userDir,
			packageDir,
			skipBundled: true,
			skipUser: true,
			skipProject: true,
			extraDirs: [pluginDir],
		});
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].def.name).toBe("plugin1");
		expect(result.agents[0].def.source).toBe("plugin");
	});

	it("findAgentDef returns the matching loaded def", () => {
		writeAgent(join(cwd, ".cave", "agents"), "alpha", { name: "alpha", description: "a" });
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		const found = findAgentDef(result, "alpha");
		expect(found?.def.name).toBe("alpha");
		expect(findAgentDef(result, "missing")).toBeUndefined();
	});

	it("formatAgentList returns a friendly preview", () => {
		writeAgent(join(cwd, ".cave", "agents"), "alpha", { name: "alpha", description: "first" });
		writeAgent(join(cwd, ".cave", "agents"), "beta", { name: "beta", description: "second" });
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		const text = formatAgentList(result);
		expect(text).toContain("alpha");
		expect(text).toContain("beta");
	});

	it("returns empty list (no error) when no agents anywhere", () => {
		const result = loadAgentDefs({ cwd, userDir, packageDir });
		expect(result.agents).toEqual([]);
		expect(formatAgentList(result)).toBe("(no agents loaded)");
	});

	it("loads the bundled defaults shipped with this package", () => {
		// Use the real package dir — we should pick up explore + reviewer + tester +
		// implementer + critic.
		const realResult = loadAgentDefs({
			cwd,
			userDir,
			// no packageDir override → uses getPackageDir()
			skipUser: true,
			skipProject: true,
		});
		const names = realResult.agents.map((a) => a.def.name).sort();
		// At minimum the P0 defaults must be there.
		expect(names).toContain("explore");
		expect(names).toContain("reviewer");
		expect(names).toContain("tester");
	});
});
