/**
 * `/hooks` slash command — list, test, and manage cave's lifecycle hooks.
 *
 * Self-contained handler so it can be invoked from interactive mode,
 * print mode, or `cave hooks` CLI without re-importing the TUI stack.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAVE_HOOK_EVENTS, HooksManager, HooksRegistry, type HooksConfig } from "../hooks/index.js";
import type { SettingsManager } from "../settings-manager.js";

export interface HooksCommandResult {
	exitCode: number;
	output: string;
}

export interface HooksCommandIO {
	settings: SettingsManager;
	cwd: string;
	manager?: HooksManager; // optional: provide a manager to actually run `test`
}

/**
 * Top-level dispatcher. Accepts the verbatim trailing text of the
 * slash command (e.g. "list", "test PreToolUse Bash", "enable").
 */
export async function runHooksCommand(args: string, io: HooksCommandIO): Promise<HooksCommandResult> {
	const argv = args.trim().split(/\s+/).filter(Boolean);
	const sub = argv[0] ?? "list";

	switch (sub) {
		case "list":
			return runList(argv.slice(1), io);
		case "test":
			return runTest(argv.slice(1), io);
		case "enable":
			io.settings.setDisableAllHooks(false);
			return ok("Hooks enabled.");
		case "disable":
			io.settings.setDisableAllHooks(true);
			return ok("Hooks disabled (disableAllHooks=true).");
		case "events":
			return ok(formatEventList());
		case "recipes":
			return ok(formatRecipesList());
		case "install-recipe":
			return runInstallRecipe(argv.slice(1), io);
		case "help":
		case "--help":
		case "-h":
		default:
			return ok(formatHelp());
	}
}

function ok(output: string): HooksCommandResult {
	return { exitCode: 0, output };
}
function err(output: string): HooksCommandResult {
	return { exitCode: 1, output };
}

function formatHelp(): string {
	return [
		"cave hooks — Claude Code-compatible lifecycle hooks",
		"",
		"Usage:",
		"  /hooks list                    Show every configured hook (project + global)",
		"  /hooks events                  List the 12 cave-supported lifecycle events",
		"  /hooks test <event> [matcher]  Run all hooks matched for <event> with a synthetic payload",
		"  /hooks recipes                 Show the bundled recipe scripts",
		"  /hooks install-recipe <name>   Copy a recipe into .cave/hooks/ and append a wiring stub",
		"  /hooks enable                  Set disableAllHooks=false in global settings",
		"  /hooks disable                 Set disableAllHooks=true in global settings",
		"  /hooks help                    Show this help",
		"",
		"Schema source: https://code.claude.com/docs/en/hooks (Claude Code v2.1.119)",
	].join("\n");
}

function formatEventList(): string {
	return ["Cave-supported hook events:", ...CAVE_HOOK_EVENTS.map((e) => `  - ${e}`)].join("\n");
}

function runList(_argv: string[], io: HooksCommandIO): HooksCommandResult {
	const registry = buildRegistryFromSettings(io.settings);
	const summary = registry.summarize();
	const issues = registry.getIssues();

	if (summary.length === 0) {
		const lines = [
			"No hooks configured.",
			"",
			"Add a `hooks` block to ~/.cave/settings.json or .cave/settings.json — see /hooks recipes for examples.",
		];
		return ok(lines.join("\n"));
	}

	const grouped = new Map<string, typeof summary>();
	for (const entry of summary) {
		const key = entry.event;
		const arr = grouped.get(key) ?? [];
		arr.push(entry);
		grouped.set(key, arr);
	}

	const lines: string[] = ["Configured hooks:"];
	for (const [event, entries] of grouped) {
		lines.push(`  ${event}`);
		for (const e of entries) {
			const matcher = e.matcher ? `[${e.matcher}]` : "[*]";
			lines.push(`    - ${matcher} type=${e.type} scope=${e.scope}`);
		}
	}
	if (issues.length > 0) {
		lines.push("");
		lines.push("Issues:");
		for (const i of issues) {
			lines.push(`  - (${i.scope}${i.event ? `/${i.event}` : ""}) ${i.message}`);
		}
	}
	return ok(lines.join("\n"));
}

async function runTest(argv: string[], io: HooksCommandIO): Promise<HooksCommandResult> {
	const event = argv[0];
	const matcher = argv[1];
	if (!event) {
		return err("Usage: /hooks test <event> [matcher]");
	}
	if (!CAVE_HOOK_EVENTS.includes(event as (typeof CAVE_HOOK_EVENTS)[number])) {
		return err(`Unknown event '${event}'. Try: ${CAVE_HOOK_EVENTS.join(", ")}`);
	}
	const manager = io.manager ?? buildManagerFromSettings(io);
	const result = await manager.test(event, matcher);
	const lines: string[] = [];
	lines.push(`Event: ${event}${matcher ? `  matcher: ${matcher}` : ""}`);
	if (result.results.length === 0) {
		lines.push("  (no hooks matched — nothing to run)");
		return ok(lines.join("\n"));
	}
	for (const r of result.results) {
		lines.push("");
		lines.push(`  hook: ${r.hookConfig.command ?? "(no command)"}`);
		lines.push(`    exit=${r.exitCode}${r.timedOut ? " (TIMED OUT)" : ""}  duration=${r.durationMs}ms`);
		if (r.permission) lines.push(`    permission: ${r.permission}`);
		if (r.additionalContext) lines.push(`    additionalContext: ${truncate(r.additionalContext, 200)}`);
		if (r.stdout.trim()) lines.push(`    stdout: ${truncate(r.stdout, 200)}`);
		if (r.stderr.trim()) lines.push(`    stderr: ${truncate(r.stderr, 200)}`);
	}
	if (result.permission) lines.push(`\nFinal permission: ${result.permission}`);
	if (!result.continue) lines.push(`\nHook signaled stop: ${result.stopReason ?? "(no reason)"}`);
	return ok(lines.join("\n"));
}

function truncate(s: string, n: number): string {
	const single = s.replace(/\s+/g, " ").trim();
	return single.length <= n ? single : `${single.slice(0, n - 1)}…`;
}

/** List bundled recipes. */
function formatRecipesList(): string {
	const recipes = listRecipes();
	const lines = ["Bundled hook recipes:", ""];
	for (const r of recipes) {
		lines.push(`  ${r.name}`);
		lines.push(`    event=${r.event} matcher=${r.matcher ?? "*"}`);
		lines.push(`    ${r.description}`);
		lines.push("");
	}
	lines.push("Install one with: /hooks install-recipe <name>");
	return lines.join("\n");
}

function runInstallRecipe(argv: string[], io: HooksCommandIO): HooksCommandResult {
	const name = argv[0];
	if (!name) {
		return err("Usage: /hooks install-recipe <name>. Run /hooks recipes for the list.");
	}
	const recipes = listRecipes();
	const recipe = recipes.find((r) => r.name === name || r.name === `${name}.sh`);
	if (!recipe) {
		return err(`Unknown recipe '${name}'. Run /hooks recipes for the list.`);
	}
	const sourcePath = recipe.path;
	if (!existsSync(sourcePath)) {
		return err(`Recipe source missing: ${sourcePath}`);
	}
	const dest = join(io.cwd, ".cave", "hooks", recipe.name);
	mkdirSync(dirname(dest), { recursive: true });
	const content = readFileSync(sourcePath, "utf-8");
	writeFileSync(dest, content, { mode: 0o755 });
	const stub = stubFor(recipe);
	return ok(
		[`Installed ${recipe.name} → ${dest}`, "", "Add this to .cave/settings.json `hooks`:", "", stub].join("\n"),
	);
}

interface RecipeMeta {
	name: string;
	path: string;
	event: string;
	matcher?: string;
	description: string;
}

export function listRecipes(): RecipeMeta[] {
	const recipesDir = resolveRecipesDir();
	return [
		{
			name: "auto-format-on-edit.sh",
			path: join(recipesDir, "auto-format-on-edit.sh"),
			event: "PostToolUse",
			matcher: "Edit|Write",
			description: "Run biome / prettier / ruff / gofmt / rustfmt on every file the agent touches.",
		},
		{
			name: "auto-test-on-stop.sh",
			path: join(recipesDir, "auto-test-on-stop.sh"),
			event: "Stop",
			description: "Run the project's test command at end-of-turn; output becomes assistant context.",
		},
		{
			name: "conventional-commit-gate.sh",
			path: join(recipesDir, "conventional-commit-gate.sh"),
			event: "PreToolUse",
			matcher: "Bash",
			description: "Block git commits whose message doesn't follow Conventional Commits 1.0.0.",
		},
		{
			name: "secret-scan.sh",
			path: join(recipesDir, "secret-scan.sh"),
			event: "PreToolUse",
			matcher: "Write|Edit",
			description: "Block writes that contain AWS / GitHub / OpenAI / Anthropic / PEM-key patterns.",
		},
	];
}

function resolveRecipesDir(): string {
	// Resolve relative to this compiled file: dist/core/slash-commands/hooks.js
	// Recipe scripts ship under packages/coding-agent/src/core/hooks/recipes/
	// and are copied to dist by tsc (we declare them in package.json `files`).
	const here = fileURLToPath(import.meta.url);
	// Try sibling-first (compiled): ../hooks/recipes
	const compiled = resolve(here, "..", "..", "hooks", "recipes");
	if (existsSync(compiled)) return compiled;
	// Fallback: source tree (used by tests + dev mode).
	return resolve(here, "..", "..", "..", "..", "src", "core", "hooks", "recipes");
}

function stubFor(recipe: RecipeMeta): string {
	const matcherLine = recipe.matcher ? `\n        "matcher": "${recipe.matcher}",` : "";
	return JSON.stringify(
		{
			hooks: {
				[recipe.event]: [
					{
						matcher: recipe.matcher,
						hooks: [
							{
								type: "command",
								command: `$CAVE_PROJECT_DIR/.cave/hooks/${recipe.name}`,
							},
						],
					},
				],
			},
		},
		null,
		2,
	).replace('"matcher": null,', matcherLine.trim());
}

/** Build a registry from the current settings layers. */
export function buildRegistryFromSettings(settings: SettingsManager): HooksRegistry {
	const registry = new HooksRegistry({ disableAllHooks: settings.getDisableAllHooks() });
	const global = settings.getGlobalHooks() as HooksConfig | undefined;
	const project = settings.getProjectHooks() as HooksConfig | undefined;
	registry.setLayer("global", global ?? null);
	registry.setLayer("project", project ?? null);
	return registry;
}

/** Build a HooksManager preloaded from settings (used by `/hooks test`). */
export function buildManagerFromSettings(io: HooksCommandIO): HooksManager {
	const manager = new HooksManager({
		cwd: () => io.cwd,
		projectDir: () => io.cwd,
		registry: { disableAllHooks: io.settings.getDisableAllHooks() },
	});
	const global = io.settings.getGlobalHooks() as HooksConfig | undefined;
	const project = io.settings.getProjectHooks() as HooksConfig | undefined;
	manager.registry.setLayer("global", global ?? null);
	manager.registry.setLayer("project", project ?? null);
	return manager;
}
