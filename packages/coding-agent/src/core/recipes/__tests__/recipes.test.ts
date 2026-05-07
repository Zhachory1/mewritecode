/**
 * WS14 recipe tests.
 *
 * Coverage:
 *   1. Schema validation — valid and invalid recipes
 *   2. Input substitution — {{var}} placeholders
 *   3. Name resolution precedence — project > user > bundled
 *   4. Include flattening — merge behaviour
 *   5. Cycle detection — throws on circular includes
 *   6. Runner happy path — executor called with resolved goal
 *   7. Slash-command parser
 *   8. All 10 bundled defaults parse cleanly
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecipeSlash, runRecipeSlashCommand } from "../../slash-commands/recipe.js";
import {
	flattenIncludes,
	getBundledRecipesDir,
	listAvailableRecipes,
	loadRecipeFile,
	resolveRecipeByName,
	substituteInputs,
} from "../loader.js";
import { runRecipe } from "../runner.js";
import { RecipeValidationError, validateRecipe } from "../schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
	const dir = join(tmpdir(), `cave-recipe-test-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeYaml(dir: string, name: string, content: string): string {
	const filePath = join(dir, `${name}.yaml`);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

beforeEach(() => {
	tmpDir = makeTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Schema validation
// ---------------------------------------------------------------------------

describe("validateRecipe", () => {
	it("accepts a minimal valid recipe", () => {
		const r = validateRecipe({ goal: "Fix all linting errors" });
		expect(r.goal).toBe("Fix all linting errors");
	});

	it("accepts a full recipe with all optional fields", () => {
		const r = validateRecipe({
			goal: "Run tests",
			tools: ["read", "bash"],
			disallowedTools: ["write"],
			model: "claude-sonnet",
			effort: "high",
			env: { NODE_ENV: "test" },
			include: ["bump-deps"],
			inputs: {
				target: { description: "file to test", required: true },
			},
		});
		expect(r.tools).toEqual(["read", "bash"]);
		expect(r.effort).toBe("high");
	});

	it("rejects a recipe missing goal", () => {
		expect(() => validateRecipe({ tools: ["read"] })).toThrowError(RecipeValidationError);
	});

	it("rejects a blank goal", () => {
		expect(() => validateRecipe({ goal: "   " })).toThrowError(RecipeValidationError);
	});

	it("rejects an invalid effort value", () => {
		expect(() => validateRecipe({ goal: "x", effort: "ultra" })).toThrowError(RecipeValidationError);
	});

	it("rejects non-string values in env", () => {
		expect(() => validateRecipe({ goal: "x", env: { FOO: 123 } })).toThrowError(RecipeValidationError);
	});

	it("rejects an inputs entry missing description", () => {
		expect(() => validateRecipe({ goal: "x", inputs: { foo: { required: true } } })).toThrowError(
			RecipeValidationError,
		);
	});

	it("rejects a non-object top-level value", () => {
		expect(() => validateRecipe("not an object")).toThrowError(RecipeValidationError);
		expect(() => validateRecipe(null)).toThrowError(RecipeValidationError);
	});
});

// ---------------------------------------------------------------------------
// 2. Input substitution
// ---------------------------------------------------------------------------

describe("substituteInputs", () => {
	it("replaces {{var}} with provided values", () => {
		const recipe = validateRecipe({
			goal: "Migrate {{target}} to TypeScript",
			inputs: { target: { description: "path" } },
		});
		const goal = substituteInputs(recipe, { target: "src/utils" });
		expect(goal).toBe("Migrate src/utils to TypeScript");
	});

	it("uses the default when a var is not provided", () => {
		const recipe = validateRecipe({
			goal: "Run {{scope}} tests",
			inputs: { scope: { description: "scope", default: "all" } },
		});
		const goal = substituteInputs(recipe, {});
		expect(goal).toBe("Run all tests");
	});

	it("leaves unknown placeholders unchanged", () => {
		const recipe = validateRecipe({ goal: "Hello {{unknown}}" });
		const goal = substituteInputs(recipe, {});
		expect(goal).toBe("Hello {{unknown}}");
	});

	it("throws when a required input is missing and has no default", () => {
		const recipe = validateRecipe({
			goal: "Test {{file}}",
			inputs: { file: { description: "file path", required: true } },
		});
		expect(() => substituteInputs(recipe, {})).toThrowError(RecipeValidationError);
	});

	it("replaces multiple occurrences of the same placeholder", () => {
		const recipe = validateRecipe({ goal: "{{x}} and {{x}}" });
		const goal = substituteInputs(recipe, { x: "hello" });
		expect(goal).toBe("hello and hello");
	});
});

// ---------------------------------------------------------------------------
// 3. Name resolution precedence
// ---------------------------------------------------------------------------

describe("resolveRecipeByName — resolution precedence", () => {
	it("returns null when recipe does not exist", () => {
		const result = resolveRecipeByName("nonexistent-recipe", tmpDir, [tmpDir]);
		expect(result).toBeNull();
	});

	it("resolves a recipe from the provided extra dir", () => {
		writeYaml(tmpDir, "my-recipe", "goal: Hello world");
		const result = resolveRecipeByName("my-recipe", tmpDir, [tmpDir]);
		expect(result).not.toBeNull();
		expect(result!.recipe.goal).toBe("Hello world");
	});

	it("project-local dir takes precedence over later dirs", () => {
		const dir1 = join(tmpDir, "project");
		const dir2 = join(tmpDir, "global");
		mkdirSync(dir1);
		mkdirSync(dir2);

		writeYaml(dir1, "shared", "goal: From project");
		writeYaml(dir2, "shared", "goal: From global");

		const result = resolveRecipeByName("shared", tmpDir, [dir1, dir2]);
		expect(result!.recipe.goal).toBe("From project");
	});

	it("falls back to the second dir when first does not have the recipe", () => {
		const dir1 = join(tmpDir, "project");
		const dir2 = join(tmpDir, "global");
		mkdirSync(dir1);
		mkdirSync(dir2);

		writeYaml(dir2, "only-global", "goal: From global only");

		const result = resolveRecipeByName("only-global", tmpDir, [dir1, dir2]);
		expect(result!.recipe.goal).toBe("From global only");
	});

	it("resolves recipe by absolute file path", () => {
		const filePath = writeYaml(tmpDir, "abs-recipe", "goal: Absolute path recipe");
		const result = resolveRecipeByName(filePath, tmpDir, []);
		expect(result).not.toBeNull();
		expect(result!.recipe.goal).toBe("Absolute path recipe");
	});
});

// ---------------------------------------------------------------------------
// 4. Include flattening
// ---------------------------------------------------------------------------

describe("flattenIncludes", () => {
	it("returns the recipe unchanged when include is empty", async () => {
		const recipe = validateRecipe({ goal: "standalone" });
		const flat = await flattenIncludes(recipe, { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(flat.goal).toBe("standalone");
		expect(flat.include).toBeUndefined();
	});

	it("merges env from sub-recipes, root wins on collision", async () => {
		writeYaml(tmpDir, "sub", "goal: sub\nenv:\n  FOO: sub-val\n  BAR: bar-val");
		const recipe = validateRecipe({
			goal: "root",
			env: { FOO: "root-val" },
			include: ["sub"],
		});
		const flat = await flattenIncludes(recipe, { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(flat.env!.FOO).toBe("root-val"); // root wins
		expect(flat.env!.BAR).toBe("bar-val"); // sub contributes
	});

	it("merges inputs from sub-recipes, root wins on collision", async () => {
		writeYaml(
			tmpDir,
			"sub2",
			'goal: sub\ninputs:\n  shared:\n    description: "from sub"\n  extra:\n    description: "extra"',
		);
		const recipe = validateRecipe({
			goal: "root",
			inputs: { shared: { description: "from root" } },
			include: ["sub2"],
		});
		const flat = await flattenIncludes(recipe, { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(flat.inputs!.shared.description).toBe("from root");
		expect(flat.inputs!.extra.description).toBe("extra");
	});

	it("removes include from the flattened recipe", async () => {
		writeYaml(tmpDir, "leaf", "goal: leaf");
		const recipe = validateRecipe({ goal: "root", include: ["leaf"] });
		const flat = await flattenIncludes(recipe, { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(flat.include).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 5. Cycle detection
// ---------------------------------------------------------------------------

describe("flattenIncludes — cycle detection", () => {
	it("throws RecipeValidationError on a direct self-include cycle", async () => {
		// A includes A (via file path cycle): simulate by giving the recipe a filePath
		writeYaml(tmpDir, "cyclic", "goal: cyclic\ninclude:\n  - cyclic");
		const loaded = loadRecipeFile(join(tmpDir, "cyclic.yaml"));
		await expect(flattenIncludes(loaded.recipe, { cwd: tmpDir, extraDirs: [tmpDir] })).rejects.toThrow(
			RecipeValidationError,
		);
	});

	it("throws on a two-node cycle (A→B→A)", async () => {
		writeYaml(tmpDir, "alpha", "goal: alpha\ninclude:\n  - beta");
		writeYaml(tmpDir, "beta", "goal: beta\ninclude:\n  - alpha");
		const loaded = loadRecipeFile(join(tmpDir, "alpha.yaml"));
		await expect(flattenIncludes(loaded.recipe, { cwd: tmpDir, extraDirs: [tmpDir] })).rejects.toThrow(
			RecipeValidationError,
		);
	});
});

// ---------------------------------------------------------------------------
// 6. Runner happy path
// ---------------------------------------------------------------------------

describe("runRecipe", () => {
	it("calls the executor with the resolved goal and returns its result", async () => {
		writeYaml(tmpDir, "hello", 'goal: Hello {{name}}\ninputs:\n  name:\n    description: "who to greet"');

		const executor = vi.fn().mockResolvedValue({ exitCode: 0, output: "done" });

		const result = await runRecipe({
			name: "hello",
			inputs: { name: "world" },
			cwd: tmpDir,
			extraDirs: [tmpDir],
			executor,
		});

		expect(executor).toHaveBeenCalledOnce();
		expect(executor.mock.calls[0][0].goal).toBe("Hello world");
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("done");
		expect(result.resolvedGoal).toBe("Hello world");
	});

	it("sets env vars before calling the executor and restores them after", async () => {
		writeYaml(tmpDir, "env-test", "goal: check env\nenv:\n  MY_TEST_VAR: injected");

		const captured: string[] = [];
		const executor = vi.fn().mockImplementation(async () => {
			captured.push(process.env.MY_TEST_VAR ?? "(unset)");
			return { exitCode: 0 };
		});

		const previousVal = process.env.MY_TEST_VAR;
		await runRecipe({ name: "env-test", cwd: tmpDir, extraDirs: [tmpDir], executor });

		expect(captured[0]).toBe("injected");
		expect(process.env.MY_TEST_VAR).toBe(previousVal); // restored
	});

	it("throws RecipeValidationError when recipe not found", async () => {
		const executor = vi.fn();
		await expect(runRecipe({ name: "does-not-exist", cwd: tmpDir, extraDirs: [tmpDir], executor })).rejects.toThrow(
			RecipeValidationError,
		);
		expect(executor).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 7. Slash-command parser
// ---------------------------------------------------------------------------

describe("parseRecipeSlash", () => {
	it("returns help when no args", () => {
		expect(parseRecipeSlash("").verb).toBe("help");
		expect(parseRecipeSlash("/recipe").verb).toBe("help");
		expect(parseRecipeSlash("help").verb).toBe("help");
	});

	it("returns list verb", () => {
		expect(parseRecipeSlash("list").verb).toBe("list");
		expect(parseRecipeSlash("/recipe list").verb).toBe("list");
	});

	it("parses recipe name and key=value inputs", () => {
		const p = parseRecipeSlash("release release_type=minor");
		expect(p.verb).toBe("run");
		expect(p.name).toBe("release");
		expect(p.inputs.release_type).toBe("minor");
	});

	it("handles multiple inputs", () => {
		const p = parseRecipeSlash("add-tests target=src/foo.ts extra=bar");
		expect(p.inputs.target).toBe("src/foo.ts");
		expect(p.inputs.extra).toBe("bar");
	});
});

describe("runRecipeSlashCommand", () => {
	it("returns help output for /recipe help", async () => {
		const r = await runRecipeSlashCommand("help", { cwd: tmpDir });
		expect(r.exitCode).toBe(0);
		expect(r.output).toContain("recipe");
	});

	it("returns error when recipe not found", async () => {
		const r = await runRecipeSlashCommand("run nonexistent", { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(r.exitCode).toBe(1);
		expect(r.output).toContain("not found");
	});

	it("returns goal for a found recipe", async () => {
		writeYaml(tmpDir, "greet", "goal: Hello world");
		const r = await runRecipeSlashCommand("greet", { cwd: tmpDir, extraDirs: [tmpDir] });
		expect(r.exitCode).toBe(0);
		expect(r.goal).toBe("Hello world");
		expect(r.recipe).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 8. All 10 bundled defaults parse cleanly
// ---------------------------------------------------------------------------

describe("bundled default recipes", () => {
	const EXPECTED_NAMES = [
		"migrate-deps",
		"add-feature-flag",
		"port-to-typescript",
		"add-tests",
		"bump-deps",
		"extract-component",
		"seo-audit",
		"accessibility-audit",
		"migrate-to-biome",
		"release",
	];

	it("bundled recipes directory exists and is non-empty", () => {
		const dir = getBundledRecipesDir();
		const recipes = listAvailableRecipes(tmpDir, [dir]);
		expect(recipes.length).toBeGreaterThan(0);
	});

	for (const name of EXPECTED_NAMES) {
		it(`bundled recipe "${name}" parses without error`, () => {
			const bundledDir = getBundledRecipesDir();
			const result = resolveRecipeByName(name, tmpDir, [bundledDir]);
			expect(result, `"${name}" not found in bundled dir ${bundledDir}`).not.toBeNull();
			expect(result!.recipe.goal.length).toBeGreaterThan(0);
		});
	}
});
