/**
 * WS14: Recipe loader.
 *
 * Resolution order (first match wins):
 *   1. .cave/recipes/<name>.yaml   — project-local
 *   2. ~/.cave/recipes/<name>.yaml — user-global
 *   3. <packageDir>/recipes/<name>.yaml — bundled defaults
 *
 * The loader also handles:
 *   - Flattening `include` lists (recursive, with cycle detection)
 *   - Input substitution: {{var}} → provided value or default
 *   - Bundled-defaults discovery via import.meta.url
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CONFIG_DIR_NAME } from "../../config.js";
import { type Recipe, RecipeValidationError, validateRecipe } from "./schema.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Return the directory that holds bundled recipe YAML files.
 * Works from both the compiled dist tree and the source tree (dev/tests).
 */
export function getBundledRecipesDir(): string {
	// __dirname in ESM: dirname(fileURLToPath(import.meta.url))
	const here = dirname(fileURLToPath(import.meta.url));
	// Both compiled (dist/core/recipes/) and source (src/core/recipes/) are 3
	// levels below the package root, so up 3 lands at the package root in both
	// cases. The bundled YAML files live at <package-root>/recipes/.
	const candidate = resolve(here, "..", "..", "..", "recipes");
	if (existsSync(candidate)) return candidate;
	return candidate; // Return best guess; callers handle missing dir gracefully.
}

/**
 * Build the ordered list of recipe search directories for a given cwd.
 * Callers may override to inject extra dirs (e.g. in tests).
 */
export function buildRecipeSearchDirs(cwd: string, overrideDirs?: string[]): string[] {
	if (overrideDirs) return overrideDirs;
	return [
		resolve(cwd, CONFIG_DIR_NAME, "recipes"), // project-local
		join(homedir(), CONFIG_DIR_NAME, "recipes"), // user-global
		getBundledRecipesDir(), // bundled defaults
	];
}

// ---------------------------------------------------------------------------
// Single-file loading
// ---------------------------------------------------------------------------

export interface LoadRecipeFileResult {
	recipe: Recipe;
	filePath: string;
}

/**
 * Load and validate a single YAML recipe file.
 * Throws RecipeValidationError or a parse error on failure.
 */
export function loadRecipeFile(filePath: string): LoadRecipeFileResult {
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RecipeValidationError(`Cannot read recipe file: ${msg}`, undefined, filePath);
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RecipeValidationError(`YAML parse error: ${msg}`, undefined, filePath);
	}

	const recipe = validateRecipe(parsed, filePath);
	recipe.filePath = filePath;
	if (!recipe.name) {
		recipe.name = basename(filePath, ".yaml");
	}
	return { recipe, filePath };
}

// ---------------------------------------------------------------------------
// Name-based resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a recipe by name (or absolute path) from the search directories.
 * Returns the first match or null.
 */
export function resolveRecipeByName(name: string, cwd: string, extraDirs?: string[]): LoadRecipeFileResult | null {
	// Absolute path reference: load directly.
	if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
		const candidate = isAbsolute(name) ? name : resolve(cwd, name);
		const withExt = candidate.endsWith(".yaml") ? candidate : `${candidate}.yaml`;
		for (const path of [candidate, withExt]) {
			if (existsSync(path)) return loadRecipeFile(path);
		}
		return null;
	}

	const dirs = buildRecipeSearchDirs(cwd, extraDirs);
	const candidates = [`${name}.yaml`, name]; // try with and without extension
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const cand of candidates) {
			const full = join(dir, cand);
			if (existsSync(full)) return loadRecipeFile(full);
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Include flattening
// ---------------------------------------------------------------------------

export interface FlattenIncludesOptions {
	cwd: string;
	extraDirs?: string[];
}

/**
 * Recursively flatten the `include` list of a recipe into a single merged
 * recipe. Cycle detection uses the absolute file path of each recipe.
 *
 * Merge semantics:
 *   - `goal` is taken from the root recipe (not sub-recipes).
 *   - `tools`, `disallowedTools`, `include` from sub-recipes are merged into arrays.
 *   - `env` from sub-recipes is merged (root values win on key collision).
 *   - `inputs` from sub-recipes are merged (root values win).
 *   - `model`, `effort` from the root recipe win.
 */
export async function flattenIncludes(
	recipe: Recipe,
	opts: FlattenIncludesOptions,
	_visited?: Set<string>,
): Promise<Recipe> {
	const visited = _visited ?? new Set<string>();

	// Register this recipe to detect cycles.
	const selfKey = recipe.filePath ?? recipe.name ?? recipe.goal;
	if (visited.has(selfKey)) {
		throw new RecipeValidationError(
			`Cycle detected in recipe includes: "${selfKey}" is already being processed`,
			"include",
			recipe.filePath,
		);
	}
	visited.add(selfKey);

	if (!recipe.include || recipe.include.length === 0) {
		visited.delete(selfKey);
		return recipe;
	}

	const merged: Recipe = { ...recipe };
	const mergedEnv: Record<string, string> = { ...(recipe.env ?? {}) };
	const mergedInputs: Record<string, import("./schema.js").RecipeInput> = { ...(recipe.inputs ?? {}) };
	const extraTools: string[] = [];
	const extraDisallowed: string[] = [];

	for (const includeName of recipe.include) {
		const result = resolveRecipeByName(includeName, opts.cwd, opts.extraDirs);
		if (!result) {
			throw new RecipeValidationError(`Included recipe "${includeName}" not found`, "include", recipe.filePath);
		}
		// Recursively flatten the sub-recipe.
		const sub = await flattenIncludes(result.recipe, opts, visited);

		// Merge env (root wins on collision — root already in mergedEnv).
		for (const [k, v] of Object.entries(sub.env ?? {})) {
			if (!(k in mergedEnv)) mergedEnv[k] = v;
		}
		// Merge inputs (root wins on collision).
		for (const [k, v] of Object.entries(sub.inputs ?? {})) {
			if (!(k in mergedInputs)) mergedInputs[k] = v;
		}
		// Collect extra tool restrictions.
		if (sub.tools) extraTools.push(...sub.tools);
		if (sub.disallowedTools) extraDisallowed.push(...sub.disallowedTools);
	}

	// Apply merged values.
	if (Object.keys(mergedEnv).length > 0) merged.env = mergedEnv;
	if (Object.keys(mergedInputs).length > 0) merged.inputs = mergedInputs;

	// Intersect tool allowlists: if both root and sub define tools, intersection is safest.
	const rootTools = recipe.tools ?? [];
	const allExtraTools = [...new Set(extraTools)];
	if (rootTools.length > 0 && allExtraTools.length > 0) {
		merged.tools = rootTools.filter((t) => allExtraTools.includes(t));
	} else if (allExtraTools.length > 0) {
		merged.tools = allExtraTools;
	}

	// Union disallowed tools.
	const rootDisallowed = recipe.disallowedTools ?? [];
	merged.disallowedTools = [...new Set([...rootDisallowed, ...extraDisallowed])];
	if (merged.disallowedTools.length === 0) delete merged.disallowedTools;

	// include is consumed; remove it from the final merged recipe.
	delete merged.include;

	visited.delete(selfKey);
	return merged;
}

// ---------------------------------------------------------------------------
// Input substitution
// ---------------------------------------------------------------------------

/**
 * Substitute {{var}} placeholders in the goal string using provided inputs.
 * Missing required inputs without defaults throw RecipeValidationError.
 */
export function substituteInputs(recipe: Recipe, provided: Record<string, string>): string {
	const inputs = recipe.inputs ?? {};
	const substituted = recipe.goal.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		if (key in provided) return provided[key];
		const def = inputs[key];
		if (def) {
			if (def.required && !def.default) {
				throw new RecipeValidationError(
					`Required input "${key}" not provided and has no default`,
					`inputs.${key}`,
					recipe.filePath,
				);
			}
			return def.default ?? match;
		}
		// Undefined placeholder: leave as-is.
		return match;
	});

	// Validate that all required inputs were supplied.
	for (const [key, def] of Object.entries(inputs)) {
		if (def.required && !(key in provided) && def.default === undefined) {
			throw new RecipeValidationError(`Required input "${key}" not provided`, `inputs.${key}`, recipe.filePath);
		}
	}

	return substituted;
}

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

/**
 * List all available recipes from the search directories.
 * Returns unique recipe names (project-local wins on collision).
 */
export function listAvailableRecipes(
	cwd: string,
	extraDirs?: string[],
): Array<{ name: string; filePath: string; dir: string }> {
	const dirs = buildRecipeSearchDirs(cwd, extraDirs);
	const seen = new Set<string>();
	const results: Array<{ name: string; filePath: string; dir: string }> = [];

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir) as string[];
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".yaml")) continue;
			const name = entry.slice(0, -5); // strip .yaml
			if (seen.has(name)) continue;
			seen.add(name);
			results.push({ name, filePath: join(dir, entry), dir });
		}
	}
	return results;
}
