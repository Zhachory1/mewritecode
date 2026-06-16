/**
 * Regression for #60 — bundle subagent workflow prompts by default.
 *
 * #59 stage 1 made the subagent extension default-loaded but deferred the
 * three workflow prompts (`implement`, `scout-and-plan`, `implement-and-review`)
 * because `loadPromptTemplates` had no bundled-defaults scan path. #60 ships
 * `<packageDir>/prompts/` as that path via the resource loader.
 *
 * What this test pins:
 *   1. From an empty user dir + empty cwd, the three bundled workflow prompts
 *      are loaded as available `PromptTemplate`s with the right names.
 *   2. A user-scope prompt with the same name as a bundled one OVERRIDES the
 *      bundled (first-write-wins in `dedupePrompts`; bundled is last in the
 *      path list so user/project paths take precedence).
 *   3. The `--no-prompt-templates` flag (noPromptTemplates option) opts the
 *      session out of bundled defaults too, not just user/project.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.js";

describe("#60 bundled workflow prompts", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rl-60-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads bundled workflow prompts from a fresh empty cwd + user dir", async () => {
		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { prompts } = loader.getPrompts();
		const names = prompts.map((p) => p.name).sort();

		expect(names).toEqual(
			expect.arrayContaining(["implement", "scout-and-plan", "implement-and-review"]),
		);
	});

	it("user-scope prompt with the same name overrides the bundled version", async () => {
		const userPromptsDir = join(agentDir, "prompts");
		mkdirSync(userPromptsDir, { recursive: true });
		writeFileSync(
			join(userPromptsDir, "implement.md"),
			`---
description: user-overridden implement workflow
---
USER OVERRIDE BODY`,
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { prompts } = loader.getPrompts();
		const implement = prompts.find((p) => p.name === "implement");
		expect(implement, "implement prompt must still be present").toBeDefined();
		expect(implement!.content, "user override body wins over bundled").toContain("USER OVERRIDE BODY");
	});

	it("noPromptTemplates option opts out of bundled defaults too", async () => {
		const loader = new DefaultResourceLoader({ cwd, agentDir, noPromptTemplates: true });
		await loader.reload();

		const { prompts } = loader.getPrompts();
		// With --no-prompt-templates set, only explicit CLI/additional paths
		// contribute. Bundled defaults are off, user/project paths are off.
		expect(prompts.find((p) => p.name === "implement")).toBeUndefined();
		expect(prompts.find((p) => p.name === "scout-and-plan")).toBeUndefined();
		expect(prompts.find((p) => p.name === "implement-and-review")).toBeUndefined();
	});
});
