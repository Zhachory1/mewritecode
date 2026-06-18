/**
 * WS14: `mewrite run-recipe <name> [--input k=v ...]` CLI handler.
 *
 * Resolution order: .cave/recipes/ → ~/.cave/recipes/ → bundled defaults.
 * Spawns an agent session restricted to the recipe's tool allowlist,
 * with the recipe's env, model, and effort settings applied.
 */

import chalk from "chalk";
import { listAvailableRecipes, resolveRecipeByName } from "../core/recipes/loader.js";
import type { RecipeExecutorOptions } from "../core/recipes/runner.js";
import { runRecipe } from "../core/recipes/runner.js";

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Parse --input k=v flags from the remaining args array.
 * Returns the map of key→value and leftover args.
 */
function parseInputFlags(args: string[]): { inputs: Record<string, string>; rest: string[] } {
	const inputs: Record<string, string> = {};
	const rest: string[] = [];
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--input" || arg === "-i") {
			i++;
			const kv = args[i];
			if (!kv || kv.startsWith("-")) {
				console.error(chalk.red(`Error: --input requires a k=v argument`));
				process.exit(1);
			}
			const eqIdx = kv.indexOf("=");
			if (eqIdx === -1) {
				console.error(chalk.red(`Error: --input value must be in "key=value" format, got: ${kv}`));
				process.exit(1);
			}
			inputs[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
		} else if (arg.startsWith("--input=")) {
			const kv = arg.slice("--input=".length);
			const eqIdx = kv.indexOf("=");
			if (eqIdx === -1) {
				console.error(chalk.red(`Error: --input value must be in "key=value" format, got: ${kv}`));
				process.exit(1);
			}
			inputs[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
		} else {
			rest.push(arg);
		}
		i++;
	}
	return { inputs, rest };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printRunRecipeHelp(): void {
	console.log(`mewrite run-recipe — run a Goose-style YAML recipe

Usage:
  mewrite run-recipe <name> [--input key=value ...]
  mewrite run-recipe --list

Arguments:
  <name>              Recipe name (resolved from .cave/recipes/, ~/.cave/recipes/,
                      or bundled defaults) or an absolute/relative path to a .yaml file.

Options:
  --input k=v, -i k=v Provide a value for a recipe input placeholder (repeatable).
  --list              List all available recipes from all search locations.
  --help, -h          Show this help.

Examples:
  mewrite run-recipe migrate-to-biome
  mewrite run-recipe add-tests --input target=src/utils/parser.ts
  mewrite run-recipe release --input release_type=minor
  mewrite run-recipe --list
`);
}

// ---------------------------------------------------------------------------
// List subcommand
// ---------------------------------------------------------------------------

function handleList(cwd: string): void {
	const recipes = listAvailableRecipes(cwd);
	if (recipes.length === 0) {
		console.log(chalk.dim("No recipes found."));
		console.log(chalk.dim("Add .yaml files to .cave/recipes/ or ~/.cave/recipes/"));
		return;
	}
	console.log(chalk.bold("Available recipes:"));
	for (const r of recipes) {
		const scope = r.filePath.includes("/.cave/recipes/")
			? chalk.dim("(user)")
			: r.filePath.includes("/recipes/") && !r.filePath.includes(`${cwd}/`)
				? chalk.dim("(bundled)")
				: chalk.dim("(project)");
		console.log(`  ${chalk.cyan(r.name)} ${scope}`);
		console.log(`    ${chalk.dim(r.filePath)}`);
	}
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle `mewrite run-recipe ...` args array (args[0] === "run-recipe").
 * Returns true if the command was handled (success or failure); the caller
 * should NOT continue to the session startup flow.
 */
export async function handleRunRecipeCommand(args: string[]): Promise<boolean> {
	// args[0] === "run-recipe"
	if (args[0] !== "run-recipe") return false;

	const rest = args.slice(1);

	if (rest.length === 0 || rest.includes("--help") || rest.includes("-h")) {
		printRunRecipeHelp();
		return true;
	}

	if (rest[0] === "--list") {
		handleList(process.cwd());
		return true;
	}

	const recipeName = rest[0];
	const { inputs } = parseInputFlags(rest.slice(1));

	const cwd = process.cwd();

	// Resolve early for a better error message before we hit the runner.
	const loaded = resolveRecipeByName(recipeName, cwd);
	if (!loaded) {
		console.error(chalk.red(`Error: Recipe "${recipeName}" not found.`));
		console.error(chalk.dim("Searched: .cave/recipes/, ~/.cave/recipes/, bundled defaults."));
		console.error(chalk.dim("Run `mewrite run-recipe --list` to see all available recipes."));
		process.exit(1);
	}

	console.log(chalk.bold(`Running recipe: ${chalk.cyan(recipeName)}`));
	if (loaded.recipe.filePath) {
		console.log(chalk.dim(`  Source: ${loaded.recipe.filePath}`));
	}
	if (Object.keys(inputs).length > 0) {
		console.log(
			chalk.dim(
				`  Inputs: ${Object.entries(inputs)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ")}`,
			),
		);
	}
	console.log();

	try {
		const result = await runRecipe({
			name: recipeName,
			inputs,
			cwd,
			executor: defaultExecutor,
		});

		if (result.output) {
			console.log(result.output);
		}
		process.exit(result.exitCode);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(chalk.red(`Error: ${msg}`));
		process.exit(1);
	}

	return true;
}

// ---------------------------------------------------------------------------
// Default executor
// ---------------------------------------------------------------------------

/**
 * Default executor: prints the resolved goal and spawns the agent session
 * using the mewrite session infrastructure.
 *
 * We dynamically import the session creation to avoid pulling in the full
 * agent stack at module-load time (keeps `mewrite run-recipe --list` fast).
 */
async function defaultExecutor(opts: RecipeExecutorOptions): Promise<{ exitCode: number; output?: string }> {
	const { goal, recipe } = opts;

	console.log(chalk.bold("Goal:"));
	console.log(goal.trim());
	console.log();

	// Apply recipe model override via environment (the session bootstrap reads it).
	if (recipe.model) {
		process.env.CAVE_RECIPE_MODEL = recipe.model;
	}

	// Lazy-import to avoid loading the TUI/agent stack before we need it.
	const { main } = await import("../main.js");

	// Build equivalent CLI args that main() understands.
	const mainArgs: string[] = ["--print", goal];

	if (recipe.model) {
		mainArgs.unshift("--model", recipe.model);
	}
	if (recipe.effort) {
		// Cave maps effort to thinking level: low→off, medium→low, high→medium.
		const thinkingMap: Record<string, string> = {
			low: "off",
			medium: "low",
			high: "medium",
		};
		const thinking = thinkingMap[recipe.effort];
		if (thinking) mainArgs.unshift("--thinking", thinking);
	}
	if (recipe.tools && recipe.tools.length > 0) {
		mainArgs.unshift("--tools", recipe.tools.join(","));
	}

	// main() calls process.exit() itself; we can't easily capture the code.
	// For the purposes of the recipe runner, we invoke main and let it handle exit.
	await main(mainArgs);

	return { exitCode: 0 };
}
