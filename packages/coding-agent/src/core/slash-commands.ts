/**
 * Slash commands — built-in registry plus Claude Code-compatible markdown loader.
 *
 * Provenance:
 *   The built-in registry below was carried over from pi-code (cave's upstream).
 *   The markdown loader in this file is new for cave WS5 and is modeled on
 *   Claude Code v2.1.119's commands schema. A user pasting
 *   `~/.claude/commands/foo.md` into `~/.cave/commands/foo.md` works
 *   unchanged (frontmatter is a strict superset).
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

import { type Dirent, existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { ResourceDiagnostic } from "./diagnostics.js";
import {
	applyInlineShellPreprocessing,
	substituteSkillVariables,
	type SkillExpandContext,
} from "./skills.js";
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
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "freeze", description: "Cave-optimized compaction checkpoint (optional label)" },
	{ name: "checkpoints", description: "List manual freeze checkpoints in this session" },
	{ name: "cave", description: "Control cave mode (on/off/lite/full/ultra/stats)" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "hooks", description: "List, test, and manage Claude Code-compatible lifecycle hooks (WS4)" },
	{ name: "mcp", description: "Manage MCP servers (list, doctor, login, reload). See: cave mcp --help." },
	{ name: "sandbox", description: "Show or change the sandbox policy (WS3, experimental)" },
	{ name: "quit", description: "Quit pi" },
];

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
	runHooksCommand,
	listRecipes as listHookRecipes,
	buildRegistryFromSettings as buildHooksRegistryFromSettings,
	buildManagerFromSettings as buildHooksManagerFromSettings,
} from "./slash-commands/hooks.js";

// WS3: re-export the sandbox command handlers for CLI dispatch.
export { handleSandboxCommand, isSandboxFlagEnabled } from "./slash-commands/sandbox.js";
