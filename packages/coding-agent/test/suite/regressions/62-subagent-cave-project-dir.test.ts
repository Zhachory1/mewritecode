/**
 * Regression for #62 — subagent extension scanned `.pi/agents/` instead of
 * `.cave/agents/` for project-scope discovery, leaving project agents shipped
 * in cave's canonical location invisible to the bundled subagent tool.
 *
 * Behavior pinned here:
 *   1. Project-scope agents in `<cwd>/.cave/agents/` are discoverable by the
 *      subagent extension.
 *   2. Legacy `<cwd>/.pi/agents/` is honored as a fallback so projects
 *      mid-migration still work.
 *   3. When BOTH exist, `.cave/` takes precedence.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../../../examples/extensions/subagent/agents.js";

let tmpRoot: string;
let cwd: string;
let userDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cave-62-test-"));
	cwd = join(tmpRoot, "project");
	userDir = join(tmpRoot, "user-cave");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(userDir, "agents"), { recursive: true });
	// Point cave's user-agent-dir resolution at the empty fake userDir so the
	// real user dir on disk doesn't pollute results.
	process.env.CAVE_CODING_AGENT_DIR = userDir;
	process.env.PI_CODING_AGENT_DIR = userDir;
});

afterEach(() => {
	delete process.env.CAVE_CODING_AGENT_DIR;
	delete process.env.PI_CODING_AGENT_DIR;
	if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAgent(dir: string, name: string, description: string, body = "agent body"): string {
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `${name}.md`);
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
	return filePath;
}

describe("#62 subagent extension scans .cave/agents/ for project scope", () => {
	it("discovers project agents from <cwd>/.cave/agents/", () => {
		writeAgent(join(cwd, ".cave", "agents"), "cave-proj", "cave project-scope agent");

		const { agents, projectAgentsDir } = discoverAgents(cwd, "project");
		const found = agents.find((a) => a.name === "cave-proj");
		expect(found, ".cave/agents/cave-proj should be discoverable").toBeDefined();
		expect(found?.source).toBe("project");
		expect(projectAgentsDir).toBe(join(cwd, ".cave", "agents"));
	});

	it("still honors legacy <cwd>/.pi/agents/ when .cave/ is absent (mid-migration projects)", () => {
		writeAgent(join(cwd, ".pi", "agents"), "legacy-proj", "legacy .pi/ project agent");

		const { agents, projectAgentsDir } = discoverAgents(cwd, "project");
		const found = agents.find((a) => a.name === "legacy-proj");
		expect(found, ".pi/agents/ should still work as a fallback").toBeDefined();
		expect(projectAgentsDir).toBe(join(cwd, ".pi", "agents"));
	});

	it("prefers .cave/ over legacy .pi/ when BOTH exist at the same level", () => {
		writeAgent(join(cwd, ".cave", "agents"), "shared", "cave-canonical version");
		writeAgent(join(cwd, ".pi", "agents"), "shared", "legacy .pi version");

		const { agents, projectAgentsDir } = discoverAgents(cwd, "project");
		const s = agents.find((a) => a.name === "shared");
		expect(s?.description, ".cave/ wins over .pi/").toBe("cave-canonical version");
		expect(projectAgentsDir).toBe(join(cwd, ".cave", "agents"));
	});
});
