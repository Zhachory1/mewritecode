/**
 * WS14: Recipe runner.
 *
 * Orchestrates the full lifecycle of a recipe execution:
 *   1. Resolve recipe by name
 *   2. Flatten includes (with cycle detection)
 *   3. Substitute inputs into the goal
 *   4. Set env vars
 *   5. Invoke the agent via the provided executor
 *
 * The runner is deliberately thin: it does NOT own the agent runtime.
 * Callers supply a `RecipeExecutor` function that receives a resolved goal
 * and session config. This makes the runner trivially testable with a mock.
 */

import { flattenIncludes, resolveRecipeByName, substituteInputs } from "./loader.js";
import { type Recipe, RecipeValidationError } from "./schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecipeRunOptions {
	/** Recipe name or absolute path. */
	name: string;
	/** Key→value pairs from --input k=v flags. */
	inputs?: Record<string, string>;
	/** Current working directory (used for recipe discovery). */
	cwd: string;
	/** Extra recipe search directories (used in tests). */
	extraDirs?: string[];
	/** Called with the resolved, flattened, substituted recipe to actually run it. */
	executor: RecipeExecutor;
}

/**
 * The executor receives the fully-resolved recipe and the goal string
 * (with inputs substituted) and is responsible for spawning the agent session.
 *
 * Returns an arbitrary result that is passed through to the caller.
 */
export type RecipeExecutor = (opts: RecipeExecutorOptions) => Promise<RecipeExecutorResult>;

export interface RecipeExecutorOptions {
	/** The final goal prompt (inputs already substituted). */
	goal: string;
	/** The fully-resolved, flattened recipe. */
	recipe: Recipe;
}

export interface RecipeExecutorResult {
	exitCode: number;
	output?: string;
}

export interface RecipeRunResult {
	exitCode: number;
	output?: string;
	/** The resolved recipe (before input substitution). */
	recipe: Recipe;
	/** The final goal sent to the executor. */
	resolvedGoal: string;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a recipe end-to-end.
 *
 * Resolves → flattens includes → substitutes inputs → sets env → calls executor.
 */
export async function runRecipe(opts: RecipeRunOptions): Promise<RecipeRunResult> {
	const { name, inputs = {}, cwd, extraDirs, executor } = opts;

	// 1. Resolve the recipe file.
	const loaded = resolveRecipeByName(name, cwd, extraDirs);
	if (!loaded) {
		throw new RecipeValidationError(
			`Recipe "${name}" not found. Searched in .cave/recipes/, ~/.cave/recipes/, and bundled defaults.`,
			undefined,
			undefined,
		);
	}

	// 2. Flatten includes (merges env, inputs, tools from sub-recipes).
	const flat = await flattenIncludes(loaded.recipe, { cwd, extraDirs });

	// 3. Substitute inputs into the goal.
	const resolvedGoal = substituteInputs(flat, inputs);

	// 4. Apply env vars from the recipe to the current process env.
	//    We snapshot and restore so that parallel test runs don't bleed.
	const envSnapshot: Record<string, string | undefined> = {};
	if (flat.env) {
		for (const [k, v] of Object.entries(flat.env)) {
			envSnapshot[k] = process.env[k];
			process.env[k] = v;
		}
	}

	try {
		// 5. Delegate to the executor (agent runtime).
		const execResult = await executor({ goal: resolvedGoal, recipe: flat });

		return {
			exitCode: execResult.exitCode,
			output: execResult.output,
			recipe: flat,
			resolvedGoal,
		};
	} finally {
		// Restore env.
		if (flat.env) {
			for (const k of Object.keys(flat.env)) {
				const prev = envSnapshot[k];
				if (prev === undefined) {
					delete process.env[k];
				} else {
					process.env[k] = prev;
				}
			}
		}
	}
}
