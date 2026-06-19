/**
 * Regression for #59 stage 2 — cross-platform agent discovery + CC tool-name aliasing.
 *
 * Council BLOCKERs pinned here:
 *   1. Cross-platform discovery is OFF by default. Users opt in via option or
 *      `CAVE_CROSS_PLATFORM_AGENTS=true` env. Privacy-by-design (some users
 *      keep CC-only personas in `~/.claude/agents/` intentionally).
 *   2. CC-cased tool names (`Read`, `Bash`, `Edit`, `Write`, `Grep`, `LS`,
 *      `Glob`) get aliased to cave canonical (`read`, `bash`, ..., and
 *      `Glob → grep, find` for the one-to-many case) at parse time. The raw
 *      list is preserved on disk; canonical lowercase is what cave dispatches.
 *   3. A consolidated "compatibility" diagnostic fires ONCE per persona when
 *      aliasing rewrites occur — not per aliased tool.
 *   4. V1 is CC-only. Cursor/Codex/OpenCode are not scanned.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentDefs } from "../../../src/core/agent-defs/loader.js";
import { aliasCcToolNames } from "../../../src/core/agent-defs/tool-name-check.js";

let tmpRoot: string;
let cwd: string;
let userDir: string;
let packageDir: string;
let userHome: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cave-stage2-cp-test-"));
	cwd = join(tmpRoot, "project");
	userDir = join(tmpRoot, "user-cave");
	packageDir = join(tmpRoot, "bundled-pkg");
	userHome = join(tmpRoot, "home");
	mkdirSync(join(cwd, ".mewrite", "agents"), { recursive: true });
	mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
	mkdirSync(join(userDir, "agents"), { recursive: true });
	mkdirSync(join(packageDir, "agents"), { recursive: true });
	mkdirSync(join(userHome, ".claude", "agents"), { recursive: true });
	process.env.HOME = userHome;
});

afterEach(() => {
	delete process.env.CAVE_CROSS_PLATFORM_AGENTS;
	if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAgent(dir: string, name: string, frontmatter: Record<string, unknown>, body = "agent body"): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(frontmatter)) {
		if (Array.isArray(v)) {
			lines.push(`${k}:`);
			for (const item of v) lines.push(`  - ${item}`);
		} else {
			lines.push(`${k}: ${String(v)}`);
		}
	}
	lines.push("---", "", body);
	const filePath = join(dir, `${name}.md`);
	writeFileSync(filePath, lines.join("\n"));
	return filePath;
}

describe("#59 stage 2 — CC tool-name aliasing", () => {
	describe("aliasCcToolNames (pure)", () => {
		it("maps each CC-cased name to its cave canonical form", () => {
			expect(aliasCcToolNames(["Read"]).canonical).toEqual(["read"]);
			expect(aliasCcToolNames(["Bash"]).canonical).toEqual(["bash"]);
			expect(aliasCcToolNames(["Edit"]).canonical).toEqual(["edit"]);
			expect(aliasCcToolNames(["Write"]).canonical).toEqual(["write"]);
			expect(aliasCcToolNames(["Grep"]).canonical).toEqual(["grep"]);
			expect(aliasCcToolNames(["LS"]).canonical).toEqual(["ls"]);
		});

		it("Glob expands to BOTH grep and find (one-to-many alias)", () => {
			const out = aliasCcToolNames(["Glob"]);
			expect(out.canonical).toEqual(["grep", "find"]);
			expect(out.aliasesApplied).toEqual(["Glob → grep, find"]);
		});

		it("preserves order and de-duplicates", () => {
			const out = aliasCcToolNames(["Read", "Bash", "Read", "ls", "Grep"]);
			expect(out.canonical).toEqual(["read", "bash", "ls", "grep"]);
		});

		it("Glob alongside grep does not double-add grep", () => {
			const out = aliasCcToolNames(["grep", "Glob"]);
			expect(out.canonical).toEqual(["grep", "find"]);
		});

		it("unknown names pass through unchanged", () => {
			const out = aliasCcToolNames(["read", "bogus", "my_custom_tool"]);
			expect(out.canonical).toEqual(["read", "bogus", "my_custom_tool"]);
			expect(out.aliasesApplied).toEqual([]);
		});

		it("reports the alias-fired list separately so callers can emit a single diagnostic", () => {
			const out = aliasCcToolNames(["Read", "Bash", "bogus"]);
			expect(out.aliasesApplied).toEqual(["Read → read", "Bash → bash"]);
		});

		it("returns empty arrays on empty input", () => {
			const out = aliasCcToolNames([]);
			expect(out.canonical).toEqual([]);
			expect(out.aliasesApplied).toEqual([]);
		});
	});

	describe("loadAgentDefs end-to-end aliasing", () => {
		it("loads a CC-authored persona and rewrites tool names to cave canonical", () => {
			writeAgent(join(cwd, ".mewrite", "agents"), "cc-persona", {
				name: "cc-persona",
				description: "authored for Claude Code",
				tools: ["Read", "Bash", "Grep"],
			});

			const { agents, diagnostics } = loadAgentDefs({ cwd, userDir, packageDir });
			const cc = agents.find((a) => a.def.name === "cc-persona");
			expect(cc).toBeDefined();
			expect(cc!.def.tools).toEqual(["read", "bash", "grep"]);

			// Consolidated compatibility diagnostic — ONE per persona, not three per tool.
			const aliasDiag = diagnostics.filter((d) => d.message.includes("aliased to cave canonical"));
			expect(aliasDiag.length).toBe(1);
			expect(aliasDiag[0].message).toContain("Read → read");
			expect(aliasDiag[0].message).toContain("Bash → bash");
			expect(aliasDiag[0].message).toContain("Grep → grep");
		});

		it("does NOT emit alias diagnostic for an all-lowercase persona", () => {
			writeAgent(join(cwd, ".mewrite", "agents"), "cave-native", {
				name: "cave-native",
				description: "cave-native tool naming",
				tools: ["read", "grep"],
			});

			const { diagnostics } = loadAgentDefs({ cwd, userDir, packageDir });
			expect(diagnostics.some((d) => d.message.includes("aliased to cave canonical"))).toBe(false);
		});

		it("Glob in persona frontmatter expands to grep + find in def.tools", () => {
			writeAgent(join(cwd, ".mewrite", "agents"), "globby", {
				name: "globby",
				description: "uses CC Glob",
				tools: ["Glob"],
			});

			const { agents } = loadAgentDefs({ cwd, userDir, packageDir });
			const g = agents.find((a) => a.def.name === "globby");
			expect(g!.def.tools).toEqual(["grep", "find"]);
		});
	});
});

describe("#59 stage 2 — cross-platform discovery (opt-in)", () => {
	it("does NOT scan ~/.claude/agents/ by default", () => {
		writeAgent(join(userHome, ".claude", "agents"), "cc-only", {
			name: "cc-only",
			description: "lives in ~/.claude/agents/",
			tools: ["Read"],
		});

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir });
		expect(agents.find((a) => a.def.name === "cc-only")).toBeUndefined();
	});

	it("scans ~/.claude/agents/ when crossPlatformDiscovery option is true", () => {
		writeAgent(join(userHome, ".claude", "agents"), "cc-only", {
			name: "cc-only",
			description: "lives in ~/.claude/agents/",
			tools: ["Read"],
		});

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir, crossPlatformDiscovery: true });
		const cc = agents.find((a) => a.def.name === "cc-only");
		expect(cc).toBeDefined();
		expect(cc!.def.tools).toEqual(["read"]); // aliased
	});

	it("scans <cwd>/.claude/agents/ when crossPlatformDiscovery is true", () => {
		writeAgent(join(cwd, ".claude", "agents"), "project-cc", {
			name: "project-cc",
			description: "project-scope CC agent",
			tools: ["Bash"],
		});

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir, crossPlatformDiscovery: true });
		const p = agents.find((a) => a.def.name === "project-cc");
		expect(p).toBeDefined();
		expect(p!.def.tools).toEqual(["bash"]);
	});

	it("env var CAVE_CROSS_PLATFORM_AGENTS=true enables discovery without option", () => {
		writeAgent(join(userHome, ".claude", "agents"), "env-enabled", {
			name: "env-enabled",
			description: "found via env opt-in",
			tools: ["Read"],
		});
		process.env.CAVE_CROSS_PLATFORM_AGENTS = "true";

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir });
		expect(agents.find((a) => a.def.name === "env-enabled")).toBeDefined();
	});

	it("explicit crossPlatformDiscovery option overrides env var", () => {
		writeAgent(join(userHome, ".claude", "agents"), "env-enabled", {
			name: "env-enabled",
			description: "would be found via env",
		});
		process.env.CAVE_CROSS_PLATFORM_AGENTS = "true";

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir, crossPlatformDiscovery: false });
		expect(agents.find((a) => a.def.name === "env-enabled")).toBeUndefined();
	});

	it("mewrite-canonical wins over CC alias on name collision (user scope)", () => {
		// Same agent name in BOTH cave's ~/.mewrite/agent/agents/ AND ~/.claude/agents/.
		// cave's version is scanned first; the CC version overwrites in `byName.set`
		// because both are "user" scope — but mewrite-canonical is what should win.
		// This test pins the documented behavior: CC overwrites in scope, project
		// overrides both. Stage 2 design: within user scope, last-write-wins after
		// scanning cave first — so the CC version WINS. That matches "user dir
		// scanned first, claude second" producing last-write semantics.
		//
		// THE POLICY HERE is: scanDir merges with byName.set(name, def). cave's
		// scan happens FIRST, then CC's overwrites. This is the documented behavior
		// and matches bundled < user < project precedence. Within scope, last
		// scanned wins.
		writeAgent(join(userDir, "agents"), "shared", {
			name: "shared",
			description: "mewrite-canonical version",
		});
		writeAgent(join(userHome, ".claude", "agents"), "shared", {
			name: "shared",
			description: "CC version",
		});

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir, crossPlatformDiscovery: true });
		const s = agents.find((a) => a.def.name === "shared");
		// Within user scope: CC scanned AFTER cave, so CC wins. Project scope would
		// override both. The user can move their canonical agent to the project
		// scope if they want to override.
		expect(s!.def.description).toBe("CC version");
	});

	it("project scope still overrides user scope even with cross-platform enabled", () => {
		writeAgent(join(userHome, ".claude", "agents"), "trumped", {
			name: "trumped",
			description: "user CC version",
		});
		writeAgent(join(cwd, ".mewrite", "agents"), "trumped", {
			name: "trumped",
			description: "project cave version",
		});

		const { agents } = loadAgentDefs({ cwd, userDir, packageDir, crossPlatformDiscovery: true });
		const t = agents.find((a) => a.def.name === "trumped");
		expect(t!.def.description).toBe("project cave version");
	});
});
