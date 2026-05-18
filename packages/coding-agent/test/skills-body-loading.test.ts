/**
 * WS5: skill body loading & progressive disclosure.
 *
 * Validates that:
 * - `loadSkillBody` substitutes variables and runs inline shell.
 * - Re-attached skill bodies are capped at SKILL_REATTACH_TOKEN_CAP tokens.
 * - `enforceSkillTokenBudget` distributes the 25k shared budget correctly.
 * - The end-to-end "discovery → invocation" flow works for a default skill.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	enforceSkillTokenBudget,
	type LoadedSkillBody,
	loadSkillBody,
	loadSkillsFromDir,
	SKILL_REATTACH_TOKEN_CAP,
	SKILL_SHARED_TOKEN_BUDGET,
} from "../src/core/skills.js";

describe("WS5 skills — loadSkillBody + token caps", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cave-skill-body-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("substitutes args and inline shell when the body is loaded", async () => {
		const skillDir = join(dir, "greeter");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: greeter\ndescription: Says hello.\n---\nhi $1, shell says `!echo BANG`",
			"utf-8",
		);
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		expect(skills).toHaveLength(1);
		const body = await loadSkillBody(skills[0], {
			cwd: dir,
			args: ["greet", "world"],
		});
		expect(body.content).toContain("hi world");
		expect(body.content).toContain("BANG");
		expect(body.shellResults).toHaveLength(1);
	});

	it("truncates re-attached bodies to the 5k token cap", async () => {
		const skillDir = join(dir, "huge");
		mkdirSync(skillDir, { recursive: true });
		// 30k chars ≈ 7.5k tokens — well over the 5k re-attach cap.
		const big = "x".repeat(30_000);
		writeFileSync(join(skillDir, "SKILL.md"), `---\nname: huge\ndescription: Big skill body.\n---\n${big}`, "utf-8");
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		const body = await loadSkillBody(skills[0], {
			cwd: dir,
			reattach: true,
			disableShell: true,
		});
		expect(body.truncated).toBe(true);
		expect(body.approxTokens).toBeLessThanOrEqual(SKILL_REATTACH_TOKEN_CAP);
		expect(body.content).toContain("truncated to");
	});

	it("does not truncate small bodies under any cap", async () => {
		const skillDir = join(dir, "tiny");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: tiny\ndescription: Tiny skill.\n---\nhello world", "utf-8");
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		const body = await loadSkillBody(skills[0], {
			cwd: dir,
			reattach: true,
			disableShell: true,
		});
		expect(body.truncated).toBe(false);
		expect(body.content).toBe("hello world");
	});
});

describe("WS5 skills — enforceSkillTokenBudget", () => {
	function makeBody(tokens: number): LoadedSkillBody {
		const content = "y".repeat(tokens * 4);
		return {
			content,
			originalChars: content.length,
			chars: content.length,
			approxTokens: tokens,
			truncated: false,
			shellResults: [],
		};
	}

	it("includes everything when total <= shared budget", () => {
		const skill = (n: number) =>
			({
				name: `s${n}`,
				description: "x",
				filePath: "/x",
				baseDir: "/x",
				sourceInfo: { path: "/x", source: "local" },
				disableModelInvocation: false,
				frontmatter: {},
			}) as any;
		const out = enforceSkillTokenBudget(
			[
				{ skill: skill(1), body: makeBody(5_000) },
				{ skill: skill(2), body: makeBody(5_000) },
				{ skill: skill(3), body: makeBody(5_000) },
			],
			SKILL_SHARED_TOKEN_BUDGET,
		);
		expect(out.dropped).toEqual([]);
		expect(out.included).toHaveLength(3);
	});

	it("truncates the boundary skill and drops the rest", () => {
		const skill = (n: number) =>
			({
				name: `s${n}`,
				description: "x",
				filePath: "/x",
				baseDir: "/x",
				sourceInfo: { path: "/x", source: "local" },
				disableModelInvocation: false,
				frontmatter: {},
			}) as any;
		const entries = [
			{ skill: skill(1), body: makeBody(20_000) },
			{ skill: skill(2), body: makeBody(10_000) }, // only 5k will fit
			{ skill: skill(3), body: makeBody(5_000) }, // dropped
		];
		const out = enforceSkillTokenBudget(entries, SKILL_SHARED_TOKEN_BUDGET);
		expect(out.included).toHaveLength(2);
		expect(out.included[1].body.truncated).toBe(true);
		expect(out.included[1].body.approxTokens).toBe(5_000);
		expect(out.dropped.map((s) => s.name)).toEqual(["s3"]);
	});
});

describe("WS5 — end-to-end command invocation against a bundled skill", () => {
	it("can discover the bundled cavekit-methodology skill and load its body", async () => {
		const bundledSkillsDir = resolve(__dirname, "..", "skills");
		const { skills, diagnostics } = loadSkillsFromDir({
			dir: bundledSkillsDir,
			source: "test",
		});
		const collisions = diagnostics.filter((d) => d.type === "collision");
		expect(collisions).toEqual([]);

		const methodology = skills.find((s) => s.name === "cavekit-methodology");
		expect(methodology).toBeDefined();
		expect(methodology!.frontmatter!["allowed-tools"]).toEqual(["read", "grep"]);

		const body = await loadSkillBody(methodology!, {
			cwd: process.cwd(),
			disableShell: true,
		});
		expect(body.content.length).toBeGreaterThan(100);
	});
});
