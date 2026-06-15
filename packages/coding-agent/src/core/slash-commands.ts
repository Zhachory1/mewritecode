/**
 * Slash commands — built-in registry plus Claude Code-compatible markdown loader.
 *
 * Discovery
 *   - Project: `.cave/commands/*.md` (relative to cwd)
 *   - User:    `~/.cave/commands/*.md`
 *   - Bundled: `<package>/commands/*.md` (cave's defaults)
 *   - Plugins: forwarded by callers via `extraDirs`.
 *
 * Frontmatter (CC-compatible superset)
 *   - name (defaults to filename without .md)
 *   - description
 *   - argument-hint
 *   - arguments
 *   - disable-model-invocation
 *   - user-invocable (default: true)
 *   - allowed-tools
 *   - model
 *   - effort
 *   - context: fork
 *   - agent
 *   - hooks
 *   - paths
 *   - shell
 *
 * Substitutions (matches the skills loader, see `./skills.ts`):
 *   $ARGUMENTS, $@, $0..$N, ${@:N}, ${@:N:L},
 *   ${CAVE_SESSION_ID}, ${CAVE_SKILL_DIR}, ${CAVE_EFFORT}, ${ENV_NAME}.
 *
 * Inline shell preprocessing
 *   `!`cmd`` runs in cwd at expansion time; stdout replaces the literal.
 */

import { type Dirent, existsSync, type FSWatcher, readdirSync, readFileSync, statSync, watch } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { ResourceDiagnostic } from "./diagnostics.js";
import { applyInlineShellPreprocessing, type SkillExpandContext, substituteSkillVariables } from "./skills.js";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.js";

export type SlashCommandSource = "extension" | "prompt" | "skill" | "markdown";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	/**
	 * Whether the command has a live dispatch branch in interactive-mode. The
	 * /help command index lists only wired commands; unwired entries surface a
	 * "registered but not wired in this build" notice via isUnwiredBuiltinSlash.
	 */
	wired: boolean;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "help", description: "Show commands and keyboard shortcuts", wired: true },
	{ name: "settings", description: "Open settings menu", wired: true },
	{ name: "model", description: "Select model (opens selector UI)", wired: true },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", wired: true },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)", wired: true },
	{ name: "import", description: "Import and resume a session from a JSONL file", wired: true },
	{ name: "share", description: "Share session as a secret GitHub gist", wired: true },
	{ name: "copy", description: "Copy last agent message to clipboard", wired: true },
	{ name: "name", description: "Set session display name", wired: true },
	{ name: "session", description: "Show session info and stats", wired: true },
	{ name: "changelog", description: "Show changelog entries", wired: true },
	{ name: "hotkeys", description: "Show all keyboard shortcuts", wired: true },
	{ name: "fork", description: "Create a new fork from a previous message", wired: true },
	{ name: "tree", description: "Navigate session tree (switch branches)", wired: true },
	{ name: "login", description: "Login with OAuth provider", wired: true },
	{ name: "logout", description: "Logout from OAuth provider", wired: true },
	{ name: "new", description: "Start a new session", wired: true },
	{
		name: "clear",
		description: "Clear the current context and start a new session (alias for /new)",
		wired: true,
	},
	{ name: "compact", description: "Manually compact the session context", wired: true },
	{ name: "freeze", description: "Cave-optimized compaction checkpoint (optional label)", wired: true },
	{ name: "checkpoints", description: "List manual freeze checkpoints in this session", wired: true },
	{ name: "cave", description: "Control cave mode (on/off/lite/full/ultra/stats)", wired: true },
	{ name: "resume", description: "Resume a different session", wired: true },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", wired: true },
	{
		name: "hooks",
		description: "List, test, and manage Claude Code-compatible lifecycle hooks (WS4)",
		wired: true,
	},
	{
		name: "mcp",
		description: "Manage MCP servers (list, doctor, login, reload). See: caveman mcp --help.",
		wired: true,
	},
	{
		name: "memory",
		description:
			"Memory layer (cavemem-backed). Subcommands: search, save, show, forget, export, consolidate, sync, off, on, config.",
		wired: true,
	},
	{
		name: "repomap",
		description: "Show the Aider-style PageRank repo map (WS8). /repomap help for subcommands.",
		wired: true,
	},
	{
		name: "architect",
		description: "Toggle architect/editor split chat mode (WS8). /architect help for subcommands.",
		wired: true,
	},
	{
		name: "recipe",
		description: "Run a Goose-style YAML recipe in the current session (WS14). /recipe help for subcommands.",
		wired: true,
	},
	{
		name: "tokens",
		description: "Show token usage by source bucket (system, repomap, chat-history, files, tool-results) (WS19).",
		wired: true,
	},
	{ name: "cost", description: "Show session cost + today + this-week totals (WS19).", wired: true },
	{ name: "checkpoint", description: "Create a labeled shadow-git snapshot (WS17). /checkpoint <name>", wired: true },
	{
		name: "rollback",
		description: "Restore from a shadow-git snapshot (WS17). /rollback [N] [--file <path>] | list",
		wired: true,
	},
	{
		name: "savings",
		description:
			"Show context bytes Caveman eliminated this session (dedup + compression + compaction) + cumulative. /savings --report for a cumulative all-time readout, /savings --share for a one-liner.",
		wired: true,
	},
	{
		name: "goal",
		description:
			"Start an autonomous goal loop (Ralph-style). Usage: /goal <text>. Runs until sentinel, caps, or paused.",
		wired: true,
	},
	{
		name: "plan",
		description: "Enter read-only plan mode. Agent produces a written plan; type /act to execute.",
		wired: true,
	},
	{
		name: "act",
		description: "Exit plan mode and restore edit tools so the agent can execute its plan.",
		wired: true,
	},
	{
		name: "approval",
		description:
			"Toggle OPT-IN approval mode (writes/bash prompt before running). /approval [on|off|status]. Human-review, NOT a sandbox.",
		wired: true,
	},
	{ name: "skills", description: "Open the skills hub overlay (browse user/project/bundled skills).", wired: true },
	{
		name: "plugins",
		description: "Open the plugins surface (alias for /skills marketplace stage; placeholder for now).",
		wired: true,
	},
	{ name: "quit", description: "Quit pi", wired: true },
];

/**
 * A registered builtin flagged not-wired in this build (no live dispatch branch).
 * The dispatch fallthrough uses this to surface a "registered but not wired"
 * notice for such commands instead of treating the input as a chat message.
 * Single source of truth with the `/help` index, which lists only wired commands.
 */
export function isUnwiredBuiltinCommand(
	name: string,
	commands: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMANDS,
): boolean {
	return commands.some((c) => c.name === name && !c.wired);
}

// =============================================================================
// Markdown command loader
// =============================================================================

/**
 * Frontmatter for a markdown slash command (CC-compatible superset).
 */
export interface MarkdownCommandFrontmatter {
	name?: string;
	description?: string;
	"argument-hint"?: string;
	arguments?: unknown;
	"disable-model-invocation"?: boolean;
	"user-invocable"?: boolean;
	"allowed-tools"?: string[] | string;
	model?: string;
	effort?: string;
	context?: "fork" | "main" | string;
	agent?: string;
	hooks?: Record<string, unknown>;
	paths?: string[] | string;
	shell?: string;
	[key: string]: unknown;
}

/**
 * A loaded markdown slash command.
 */
export interface MarkdownCommand {
	name: string;
	description: string;
	argumentHint?: string;
	body: string;
	allowedTools?: string[];
	model?: string;
	effort?: string;
	context?: string;
	agent?: string;
	hooks?: Record<string, unknown>;
	paths?: string[];
	shell?: string;
	disableModelInvocation: boolean;
	userInvocable: boolean;
	frontmatter: MarkdownCommandFrontmatter;
	filePath: string;
	sourceInfo: SourceInfo;
}

export interface LoadMarkdownCommandsResult {
	commands: MarkdownCommand[];
	diagnostics: ResourceDiagnostic[];
}

export interface LoadMarkdownCommandsOptions {
	cwd?: string;
	agentDir?: string;
	/** Bundled defaults directory (e.g. `<package>/commands`). */
	defaultsDir?: string;
	/** Extra directories supplied by plugins / extensions. */
	extraDirs?: string[];
	/** Skip default project + user dirs (used in tests). */
	includeDefaults?: boolean;
}

function asStringArray(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (typeof value === "string") {
		// Comma- or whitespace-separated list, both common in CC YAML.
		return value
			.split(/[,\s]+/g)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return undefined;
}

function determineSource(filePath: string, cwd: string, agentDir: string): SourceInfo {
	const normalized = resolve(filePath);
	const projectDir = resolve(cwd, CONFIG_DIR_NAME, "commands");
	const userDir = resolve(agentDir, "commands");

	if (normalized.startsWith(`${projectDir}${"/"}`) || normalized === projectDir) {
		return createSyntheticSourceInfo(filePath, { source: "local", scope: "project", baseDir: projectDir });
	}
	if (normalized.startsWith(`${userDir}${"/"}`) || normalized === userDir) {
		return createSyntheticSourceInfo(filePath, { source: "local", scope: "user", baseDir: userDir });
	}
	return createSyntheticSourceInfo(filePath, { source: "local" });
}

function loadCommandFromFile(
	filePath: string,
	cwd: string,
	agentDir: string,
): { command: MarkdownCommand | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : "failed to read file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { command: null, diagnostics };
	}

	let parsed: ReturnType<typeof parseFrontmatter<MarkdownCommandFrontmatter>>;
	try {
		parsed = parseFrontmatter<MarkdownCommandFrontmatter>(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : "failed to parse frontmatter";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { command: null, diagnostics };
	}

	const { frontmatter, body } = parsed;
	const fallbackName = basename(filePath).replace(/\.md$/i, "");
	const name = (typeof frontmatter.name === "string" && frontmatter.name) || fallbackName;

	if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
		diagnostics.push({
			type: "warning",
			message: `command name "${name}" contains invalid characters`,
			path: filePath,
		});
	}

	let description = (typeof frontmatter.description === "string" && frontmatter.description) || "";
	if (!description) {
		const firstLine = body.split("\n").find((line) => line.trim());
		if (firstLine) {
			description = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
		}
	}

	const command: MarkdownCommand = {
		name,
		description,
		argumentHint:
			typeof frontmatter["argument-hint"] === "string" ? (frontmatter["argument-hint"] as string) : undefined,
		body,
		allowedTools: asStringArray(frontmatter["allowed-tools"]),
		model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
		effort: typeof frontmatter.effort === "string" ? frontmatter.effort : undefined,
		context: typeof frontmatter.context === "string" ? frontmatter.context : undefined,
		agent: typeof frontmatter.agent === "string" ? frontmatter.agent : undefined,
		hooks:
			typeof frontmatter.hooks === "object" && frontmatter.hooks !== null
				? (frontmatter.hooks as Record<string, unknown>)
				: undefined,
		paths: asStringArray(frontmatter.paths),
		shell: typeof frontmatter.shell === "string" ? frontmatter.shell : undefined,
		disableModelInvocation: frontmatter["disable-model-invocation"] === true,
		userInvocable: frontmatter["user-invocable"] !== false,
		frontmatter,
		filePath,
		sourceInfo: determineSource(filePath, cwd, agentDir),
	};

	return { command, diagnostics };
}

function loadCommandsFromDir(
	dir: string,
	cwd: string,
	agentDir: string,
): { commands: MarkdownCommand[]; diagnostics: ResourceDiagnostic[] } {
	const commands: MarkdownCommand[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) return { commands, diagnostics };

	let entries: Dirent[] = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "failed to read directory";
		diagnostics.push({ type: "warning", message, path: dir });
		return { commands, diagnostics };
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				isFile = statSync(fullPath).isFile();
			} catch {
				continue;
			}
		}
		if (!isFile || !entry.name.endsWith(".md")) continue;

		const result = loadCommandFromFile(fullPath, cwd, agentDir);
		if (result.command) commands.push(result.command);
		diagnostics.push(...result.diagnostics);
	}

	return { commands, diagnostics };
}

function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p.startsWith("~")) return join(homedir(), p.slice(1));
	return p;
}

/**
 * Load markdown slash commands from project, user, bundled-defaults, and any
 * extra plugin/extension directories. First-write-wins on name collision.
 */
export function loadMarkdownCommands(options: LoadMarkdownCommandsOptions = {}): LoadMarkdownCommandsResult {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const includeDefaults = options.includeDefaults ?? true;

	const dirs: string[] = [];
	if (includeDefaults) {
		// Order is precedence (project > user > bundled defaults > plugins).
		dirs.push(resolve(cwd, CONFIG_DIR_NAME, "commands"));
		dirs.push(resolve(agentDir, "commands"));
		if (options.defaultsDir) dirs.push(options.defaultsDir);
	}
	for (const extra of options.extraDirs ?? []) {
		const expanded = expandTilde(extra);
		dirs.push(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
	}

	const seen = new Map<string, MarkdownCommand>();
	const allDiagnostics: ResourceDiagnostic[] = [];

	for (const dir of dirs) {
		const result = loadCommandsFromDir(dir, cwd, agentDir);
		allDiagnostics.push(...result.diagnostics);
		for (const command of result.commands) {
			const existing = seen.get(command.name);
			if (existing) {
				allDiagnostics.push({
					type: "collision",
					message: `command "${command.name}" collision`,
					path: command.filePath,
					collision: {
						resourceType: "prompt",
						name: command.name,
						winnerPath: existing.filePath,
						loserPath: command.filePath,
					},
				});
				continue;
			}
			seen.set(command.name, command);
		}
	}

	return { commands: Array.from(seen.values()), diagnostics: allDiagnostics };
}

/**
 * Expand a markdown command's body by applying argument substitution, named
 * variables, and inline shell preprocessing.
 */
export async function expandMarkdownCommand(
	command: MarkdownCommand,
	ctx: SkillExpandContext,
): Promise<{ content: string; shellResults: Array<{ command: string; ok: boolean; output: string }> }> {
	const substituted = substituteSkillVariables(command.body, ctx);
	if (ctx.disableShell) {
		return { content: substituted, shellResults: [] };
	}
	const { content, results } = await applyInlineShellPreprocessing(substituted, {
		cwd: ctx.cwd,
		timeoutMs: ctx.shellTimeoutMs ?? 5_000,
		shell: command.shell,
	});
	return { content, shellResults: results };
}

/** Convert a MarkdownCommand into a SlashCommandInfo (for picker UIs). */
export function toSlashCommandInfo(command: MarkdownCommand): SlashCommandInfo {
	return {
		name: command.name,
		description: command.description || command.argumentHint,
		source: "markdown",
		sourceInfo: command.sourceInfo,
	};
}

// =============================================================================
// Hot reload watcher (commands)
// =============================================================================

export interface CommandWatcherOptions {
	dirs: string[];
	onChange: (event: { path: string; eventType: "rename" | "change" }) => void;
	debounceMs?: number;
}

export function watchMarkdownCommands(options: CommandWatcherOptions): { dispose: () => void } {
	const watchers: FSWatcher[] = [];
	const debounce = options.debounceMs ?? 150;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: { path: string; eventType: "rename" | "change" } | null = null;

	const flush = () => {
		if (!pending) return;
		const evt = pending;
		pending = null;
		timer = null;
		try {
			options.onChange(evt);
		} catch {
			// Listener errors must not kill the watcher.
		}
	};

	const enqueue = (filename: string | null, eventType: "rename" | "change", baseDir: string) => {
		if (!filename) return;
		const fullPath = join(baseDir, filename);
		if (!fullPath.endsWith(".md")) return;
		pending = { path: fullPath, eventType };
		if (timer) clearTimeout(timer);
		timer = setTimeout(flush, debounce);
	};

	for (const dir of options.dirs) {
		if (!existsSync(dir)) continue;
		try {
			const w = watch(dir, (event, filename) => {
				enqueue(filename ? String(filename) : null, event, dir);
			});
			watchers.push(w);
		} catch {
			// Skip dir.
		}
	}

	return {
		dispose() {
			if (timer) clearTimeout(timer);
			for (const w of watchers) {
				try {
					w.close();
				} catch {}
			}
		},
	};
}

/**
 * Resolve the bundled defaults directory shipped with cave.
 *
 * Walks up from this file searching for a `commands/` sibling next to the
 * package.json. Returns undefined if not found.
 */
export function findBundledCommandsDir(packageDir: string): string | undefined {
	const candidate = resolve(packageDir, "commands");
	if (existsSync(candidate)) return candidate;
	return undefined;
}

// =============================================================================
// /hooks subcommand re-exports (WS4)
// =============================================================================

export {
	buildManagerFromSettings as buildHooksManagerFromSettings,
	buildRegistryFromSettings as buildHooksRegistryFromSettings,
	listRecipes as listHookRecipes,
	runHooksCommand,
} from "./slash-commands/hooks.js";
export type { MemorySlashContext, MemorySlashResult } from "./slash-commands/memory.js";

// WS7: re-export the memory command handlers for CLI dispatch.
export {
	buildSessionStartPrelude,
	parseMemorySlash,
	runMemorySlashCommand,
} from "./slash-commands/memory.js";

// =============================================================================
// /plan and /act (Gap 2 — agent-harness wire-up)
// =============================================================================

export type { ActCommandIO, ActCommandResult } from "./slash-commands/act.js";
export { runActCommand } from "./slash-commands/act.js";
export type { PlanCommandIO, PlanCommandResult } from "./slash-commands/plan.js";
export { runPlanCommand } from "./slash-commands/plan.js";

// =============================================================================
// /repomap and /architect (WS8)
// =============================================================================

export type { ArchitectCommandIO, ArchitectCommandResult } from "./slash-commands/architect.js";
export { runArchitectCommand } from "./slash-commands/architect.js";
export type { RepomapChatState, RepomapCommandIO, RepomapCommandResult } from "./slash-commands/repomap.js";
export {
	collectSourceFiles as collectRepomapSourceFiles,
	emptyChatState as emptyRepomapChatState,
	runRepomapCommand,
} from "./slash-commands/repomap.js";

// =============================================================================
// /recipe (WS14)
// =============================================================================

export type { RecipeSlashCommandIO, RecipeSlashCommandResult } from "./slash-commands/recipe.js";
export {
	parseRecipeSlash,
	RECIPE_SLASH_COMMAND,
	runRecipeSlashCommand,
} from "./slash-commands/recipe.js";

// =============================================================================
// /tokens and /cost (WS19)
// =============================================================================

export type { CostCommandContext, CostCommandResult } from "./slash-commands/cost.js";
export { runCostCommand } from "./slash-commands/cost.js";
export type { TokensCommandContext, TokensCommandResult } from "./slash-commands/tokens.js";
export { runTokensCommand } from "./slash-commands/tokens.js";
