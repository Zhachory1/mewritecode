// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal ${VAR} substrings are the variables under test.
/**
 * WS5: skill frontmatter parser + substitution engine.
 *
 * Validates that:
 * - The full Claude Code v2.1.119 frontmatter superset round-trips into
 *   `Skill.frontmatter`.
 * - `substituteSkillVariables` honours every variable shape documented in
 *   the WS5 plan.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSkillsFromDir, substituteSkillVariables } from "../src/core/skills.js";

describe("WS5 skills — frontmatter parser", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cave-skill-frontmatter-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("preserves the full Claude Code-spec frontmatter superset", () => {
		const skillDir = join(dir, "fancy-skill");
		mkdirSync(skillDir, { recursive: true });
		const body = [
			"---",
			"name: fancy-skill",
			"description: A skill that exercises every supported frontmatter key.",
			'argument-hint: "<scope> [--flag]"',
			"arguments:",
			"  - name: scope",
			"    required: true",
			"    description: Path or glob to operate on",
			"disable-model-invocation: false",
			"user-invocable: true",
			"allowed-tools:",
			"  - read",
			"  - bash",
			"model: claude-3-5-sonnet-latest",
			"effort: high",
			"context: fork",
			"agent: .cave/agents/explorer.md",
			"hooks:",
			"  PreToolUse:",
			"    - matchers: [bash]",
			"      command: echo audit",
			"paths:",
			"  - src/**",
			"  - tests/**",
			"shell: /bin/bash",
			"---",
			"",
			"# Body",
			"hello",
		].join("\n");
		writeFileSync(join(skillDir, "SKILL.md"), body, "utf-8");

		const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "test" });
		expect(diagnostics).toEqual([]);
		expect(skills).toHaveLength(1);
		const skill = skills[0];
		expect(skill.name).toBe("fancy-skill");
		expect(skill.description).toContain("exercises every");
		expect(skill.disableModelInvocation).toBe(false);

		const fm = skill.frontmatter!;
		expect(fm["argument-hint"]).toBe("<scope> [--flag]");
		expect(fm.arguments).toBeDefined();
		expect(fm["allowed-tools"]).toEqual(["read", "bash"]);
		expect(fm.model).toBe("claude-3-5-sonnet-latest");
		expect(fm.effort).toBe("high");
		expect(fm.context).toBe("fork");
		expect(fm.agent).toBe(".cave/agents/explorer.md");
		expect(fm.hooks).toBeTypeOf("object");
		expect(fm.paths).toEqual(["src/**", "tests/**"]);
		expect(fm.shell).toBe("/bin/bash");
		expect(fm["user-invocable"]).toBe(true);
	});

	it("flips disableModelInvocation when frontmatter sets it true", () => {
		const skillDir = join(dir, "explicit-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			[
				"---",
				"name: explicit-skill",
				"description: Hidden skill, only invokable explicitly.",
				"disable-model-invocation: true",
				"---",
				"",
				"body",
			].join("\n"),
			"utf-8",
		);
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].disableModelInvocation).toBe(true);
	});
});

describe("WS5 skills — substitution engine", () => {
	it("expands $ARGUMENTS / $@ from rawArguments", () => {
		const out = substituteSkillVariables("run $ARGUMENTS now ($@)", {
			cwd: process.cwd(),
			rawArguments: "alpha beta",
		});
		expect(out).toBe("run alpha beta now (alpha beta)");
	});

	it("expands $0..$N from positional args", () => {
		const out = substituteSkillVariables("$0 says $1 to $2", {
			cwd: process.cwd(),
			args: ["greet", "hello", "world"],
		});
		expect(out).toBe("greet says hello to world");
	});

	it("supports bash-style ${@:N} and ${@:N:L} slicing", () => {
		const out = substituteSkillVariables("first=${@:1:1} | from2=${@:2}", {
			cwd: process.cwd(),
			args: ["zero", "one", "two", "three"],
		});
		expect(out).toBe("first=zero | from2=one two three");
	});

	it("expands the cave-specific named variables", () => {
		const out = substituteSkillVariables("sid=${CAVE_SESSION_ID} dir=${CAVE_SKILL_DIR} effort=${CAVE_EFFORT}", {
			cwd: process.cwd(),
			sessionId: "abc-123",
			skillDir: "/skills/foo",
			effort: "high",
		});
		expect(out).toBe("sid=abc-123 dir=/skills/foo effort=high");
	});

	it("falls back to process.env for unknown ${NAME} variables", () => {
		const prev = process.env.WS5_TEST_VAR;
		process.env.WS5_TEST_VAR = "hello-from-env";
		try {
			const out = substituteSkillVariables("env=${WS5_TEST_VAR}", { cwd: process.cwd() });
			expect(out).toBe("env=hello-from-env");
		} finally {
			if (prev === undefined) delete process.env.WS5_TEST_VAR;
			else process.env.WS5_TEST_VAR = prev;
		}
	});

	it("leaves truly-unknown ${NAME} variables in place", () => {
		const out = substituteSkillVariables("missing=${NEVER_DEFINED_VAR_xyz_42}", { cwd: process.cwd() });
		expect(out).toBe("missing=${NEVER_DEFINED_VAR_xyz_42}");
	});

	it("does not recursively expand substituted argument values", () => {
		// If a user passes literal "$ARGUMENTS" as $1, we must NOT recurse
		// and re-expand it.
		const out = substituteSkillVariables("got $1", {
			cwd: process.cwd(),
			args: ["zero", "$ARGUMENTS"],
			rawArguments: "should-not-leak",
		});
		expect(out).toBe("got $ARGUMENTS");
	});
});
