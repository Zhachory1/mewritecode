/**
 * Skills loader — Claude Code-compatible markdown skill definitions.
 *
 * Two filesystem locations + plugin namespace, fully Claude Code-compatible.
 * A user pasting `~/.claude/skills/<name>/SKILL.md` into `~/.cave/skills/<name>/SKILL.md`
 * MUST work unchanged.
 */

import { existsSync, type FSWatcher, readdirSync, readFileSync, realpathSync, statSync, watch } from "fs";
import ignore from "ignore";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { ResourceDiagnostic } from "./diagnostics.js";
import { execCommand } from "./exec.js";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.js";

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Approximate characters per token for budgeting.
 * Used by enforceSkillTokenBudget; conservative ~4 chars/token average.
 */
const CHARS_PER_TOKEN = 4;

/** Per-skill cap (in tokens) when a skill body is re-attached after compaction. */
export const SKILL_REATTACH_TOKEN_CAP = 5_000;

/** Shared budget (in tokens) across all simultaneously attached skill bodies. */
export const SKILL_SHARED_TOKEN_BUDGET = 25_000;

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

/**
 * Claude Code-compatible skill frontmatter (full superset).
 * Source of truth: Claude Code v2.1.119 schema. A user pasting
 * `~/.claude/skills/foo/SKILL.md` into `~/.cave/skills/foo/SKILL.md` works
 * unchanged.
 *
 * `unknown` keys are tolerated and preserved on the SkillFrontmatter index
 * signature so cave can pass through future fields without a release.
 */
export interface SkillFrontmatter {
	/** Skill name; defaults to parent directory name if absent. */
	name?: string;
	/** Human-readable description. Required. Used for auto-attach matching. */
	description?: string;
	/** When true, skill cannot be auto-attached by the model — only by `/skill:<name>`. */
	"disable-model-invocation"?: boolean;
	/** Claude Code: argument hint shown in autocomplete. */
	"argument-hint"?: string;
	/** Claude Code: structured argument descriptors. */
	arguments?: SkillArgumentSpec[] | Record<string, SkillArgumentSpec>;
	/** Cave/CC: whether the user can `/<name>` directly (defaults: true). */
	"user-invocable"?: boolean;
	/** Claude Code: tools the skill is allowed to use. */
	"allowed-tools"?: string[] | string;
	/** Optional preferred model ID override for this skill. */
	model?: string;
	/** Effort level hint: low|medium|high. */
	effort?: "low" | "medium" | "high" | string;
	/** Cave-specific: when "fork", skill body is appended to forked subagent context. */
	context?: "fork" | "main" | string;
	/** Optional agent definition reference (e.g. ".cave/agents/foo.md"). */
	agent?: string;
	/** Hook configurations matching settings.json hooks key. */
	hooks?: Record<string, unknown>;
	/** Glob paths the skill applies to (auto-attach gating). */
	paths?: string[] | string;
	/** Optional shell to run inline `!`cmd`` substitutions in. */
	shell?: string;
	[key: string]: unknown;
}

export interface SkillArgumentSpec {
	name?: string;
	description?: string;
	required?: boolean;
	default?: string;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
	/**
	 * Full parsed frontmatter (all CC-spec keys + unknown passthrough).
	 * Optional for backwards compatibility with external SDK consumers
	 * that construct Skill objects directly; the loader always populates it.
	 */
	frontmatter?: SkillFrontmatter;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string, parentDirName: string): string[] {
	const errors: string[] = [];

	if (name !== parentDirName) {
		errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
	}

	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
	const errors: string[] = [];

	if (!description || description.trim() === "") {
		errors.push("description is required");
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "project":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "project",
				baseDir,
			});
		case "path":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { skills, diagnostics };
	}

	const root = rootDir ?? dir;
	const ig = ignoreMatcher ?? ignore();
	addIgnoreRules(ig, dir, root);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name !== "SKILL.md") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || ig.ignores(relPath)) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
			return { skills, diagnostics };
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			// Skip node_modules to avoid scanning dependencies
			if (entry.name === "node_modules") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a directory and follow them
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			const ignorePath = isDirectory ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) {
				continue;
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
				skills.push(...subResult.skills);
				diagnostics.push(...subResult.diagnostics);
				continue;
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		// Validate description
		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		// Use name from frontmatter, or fall back to parent directory name
		const name = frontmatter.name || parentDirName;

		// Validate name
		const nameErrors = validateName(name, parentDirName);
		for (const error of nameErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		// Still load the skill even with warnings (unless description is completely missing)
		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, diagnostics };
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir: skillDir,
				sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
				disableModelInvocation: frontmatter["disable-model-invocation"] === true,
				frontmatter,
			},
			diagnostics,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}
}

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 *
 * Per WS5 progressive disclosure: only descriptions go here. Bodies are
 * loaded on invoke via loadSkillBody().
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];

	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. Default: process.cwd() */
	cwd?: string;
	/** Agent config directory for global skills. Default: ~/.pi/agent */
	agentDir?: string;
	/** Explicit skill paths (files or directories) */
	skillPaths?: string[];
	/** Include default skills directories. Default: true */
	includeDefaults?: boolean;
}

function normalizePath(input: string): string {
	const trimmed = input.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
	return trimmed;
}

function resolveSkillPath(p: string, cwd: string): string {
	const normalized = normalizePath(p);
	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult {
	const { cwd = process.cwd(), agentDir, skillPaths = [], includeDefaults = true } = options;

	// Resolve agentDir - if not provided, use default from config
	const resolvedAgentDir = agentDir ?? getAgentDir();

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addSkills(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			// Resolve symlinks to detect duplicate files
			let realPath: string;
			try {
				realPath = realpathSync(skill.filePath);
			} catch {
				realPath = skill.filePath;
			}

			// Skip silently if we've already loaded this exact file (via symlink)
			if (realPathSet.has(realPath)) {
				continue;
			}

			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
		addSkills(loadSkillsFromDirInternal(resolve(cwd, CONFIG_DIR_NAME, "skills"), "project", true));
	}

	const userSkillsDir = join(resolvedAgentDir, "skills");
	const projectSkillsDir = resolve(cwd, CONFIG_DIR_NAME, "skills");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
			if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of skillPaths) {
		const resolvedPath = resolveSkillPath(rawPath, cwd);
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, source);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}

// =============================================================================
// WS5: Body Loading & Substitution Engine
// =============================================================================

/**
 * Context for substitution and inline shell preprocessing.
 * Mirrors the variables documented in the WS5 plan.
 */
export interface SkillExpandContext {
	/** Working directory for shell preprocessing. */
	cwd: string;
	/** Raw arguments string (for $ARGUMENTS). */
	rawArguments?: string;
	/** Positional arguments ($0, $1, …). $0 is the skill/command name by convention. */
	args?: string[];
	/** Current caveman session id; injected as ${CAVE_SESSION_ID}. */
	sessionId?: string;
	/** Effort level; injected as ${CAVE_EFFORT}. */
	effort?: string;
	/** Skill base directory (parent of SKILL.md); injected as ${CAVE_SKILL_DIR}. */
	skillDir?: string;
	/** When true, this body is being re-attached after a compaction; apply 5k cap. */
	reattach?: boolean;
	/** Maximum tokens this body may consume (overrides the default cap). */
	tokenCap?: number;
	/** Optional execution timeout for inline shell preprocessing (ms). */
	shellTimeoutMs?: number;
	/** Disable inline shell preprocessing (treat !`cmd` literally). */
	disableShell?: boolean;
}

/**
 * Result of loading and expanding a skill body.
 */
export interface LoadedSkillBody {
	/** The expanded body text (after substitution + inline shell). */
	content: string;
	/** Original character length before truncation. */
	originalChars: number;
	/** Final character length after truncation. */
	chars: number;
	/** Approximate token count (chars / 4). */
	approxTokens: number;
	/** True if truncated to fit re-attach cap. */
	truncated: boolean;
	/** Inline shell substitutions performed and their results. */
	shellResults: Array<{ command: string; ok: boolean; output: string }>;
}

/**
 * Load and expand a skill's body markdown for invocation.
 *
 * Pipeline:
 *   raw body → substitute variables → inline-shell preprocessing → token-cap.
 *
 * Inline shell uses Claude Code syntax: \`!`echo hello`\` (backticks around
 * a leading bang). The command is executed in `ctx.cwd` and its stdout
 * replaces the substitution. On timeout/failure the literal command is left
 * in place with an inline error marker.
 */
export async function loadSkillBody(skill: Skill, ctx: SkillExpandContext): Promise<LoadedSkillBody> {
	const raw = readFileSync(skill.filePath, "utf-8");
	const { body } = parseFrontmatter<SkillFrontmatter>(raw);

	const expanded = substituteSkillVariables(body, {
		...ctx,
		skillDir: ctx.skillDir ?? skill.baseDir,
	});

	const { content: shellExpanded, results } = ctx.disableShell
		? { content: expanded, results: [] as Array<{ command: string; ok: boolean; output: string }> }
		: await applyInlineShellPreprocessing(expanded, {
				cwd: ctx.cwd,
				timeoutMs: ctx.shellTimeoutMs ?? 5_000,
				shell: skill.frontmatter?.shell as string | undefined,
			});

	const cap = ctx.tokenCap ?? (ctx.reattach ? SKILL_REATTACH_TOKEN_CAP : SKILL_SHARED_TOKEN_BUDGET);
	const trailer = `\n\n[…skill body truncated to ${cap} tokens to fit budget…]`;
	const charCap = cap * CHARS_PER_TOKEN;
	const truncated = shellExpanded.length > charCap;
	const finalContent = truncated ? `${shellExpanded.slice(0, charCap - trailer.length)}${trailer}` : shellExpanded;

	return {
		content: finalContent,
		originalChars: shellExpanded.length,
		chars: finalContent.length,
		approxTokens: Math.ceil(finalContent.length / CHARS_PER_TOKEN),
		truncated,
		shellResults: results,
	};
}

/**
 * Apply the 25k shared-token budget across multiple skill bodies.
 * Greedily packs in input order; the last entry that doesn't fit is
 * truncated with a "[…truncated…]" tail. Subsequent skills are dropped
 * entirely (a diagnostic is added to a returned `dropped` list).
 */
export function enforceSkillTokenBudget(
	bodies: Array<{ skill: Skill; body: LoadedSkillBody }>,
	totalTokenBudget: number = SKILL_SHARED_TOKEN_BUDGET,
): {
	included: Array<{ skill: Skill; body: LoadedSkillBody }>;
	dropped: Skill[];
} {
	const included: Array<{ skill: Skill; body: LoadedSkillBody }> = [];
	const dropped: Skill[] = [];
	let usedTokens = 0;

	for (const entry of bodies) {
		const remaining = totalTokenBudget - usedTokens;
		if (remaining <= 0) {
			dropped.push(entry.skill);
			continue;
		}
		if (entry.body.approxTokens <= remaining) {
			included.push(entry);
			usedTokens += entry.body.approxTokens;
			continue;
		}
		// Partial fit: truncate to remaining tokens.
		const trailer = `\n\n[…skill body truncated to ${remaining} tokens to fit shared budget…]`;
		const charCap = remaining * CHARS_PER_TOKEN;
		const truncatedContent = `${entry.body.content.slice(0, Math.max(0, charCap - trailer.length))}${trailer}`;
		included.push({
			skill: entry.skill,
			body: {
				...entry.body,
				content: truncatedContent,
				chars: truncatedContent.length,
				approxTokens: remaining,
				truncated: true,
			},
		});
		usedTokens = totalTokenBudget;
	}

	return { included, dropped };
}

/**
 * Substitute variables in `text` using `ctx`.
 *
 * Supported (compatible with Claude Code, Codex, opencode, pi-code):
 * - $ARGUMENTS — full args string joined with spaces
 * - $@ — alias of $ARGUMENTS
 * - $0, $1, $2, … — positional args (0-indexed: $0 is skill/command name)
 * - ${@:N}, ${@:N:L} — bash-style slicing (1-indexed N)
 * - ${CAVE_SESSION_ID} — current session id
 * - ${CAVE_SKILL_DIR} — directory containing SKILL.md
 * - ${CAVE_EFFORT} — current effort level
 * - ${ENV_NAME} — fallback to process.env
 *
 * Replacement is non-recursive: substituted values are NOT scanned for
 * further substitutions. This matches pi-code/Claude Code behaviour.
 */
export function substituteSkillVariables(text: string, ctx: SkillExpandContext): string {
	const args = ctx.args ?? [];

	// Two-pass substitution with NUL-wrapped sentinels so substituted values
	// are NOT recursively expanded. Pass 1 replaces every variable with
	// `\u0000<id>\u0000`; pass 2 restores those sentinels with their literal
	// values. NUL bytes never appear in text-mode source, so collisions are
	// impossible.
	const NUL = "\u0000";
	const sentinels: string[] = [];
	const sentinel = (value: string): string => {
		const id = sentinels.length;
		sentinels.push(value);
		return `${NUL}${id}${NUL}`;
	};

	let result = text;

	// Positional args.
	result = result.replace(/\$(\d+)/g, (_, num) => sentinel(args[parseInt(num, 10)] ?? ""));

	// Bash-style slicing: ${@:start} or ${@:start:length}.
	result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
		let start = parseInt(startStr, 10) - 1;
		if (start < 0) start = 0;
		if (lengthStr) {
			const length = parseInt(lengthStr, 10);
			return sentinel(args.slice(start, start + length).join(" "));
		}
		return sentinel(args.slice(start).join(" "));
	});

	const allArgs = ctx.rawArguments ?? args.slice(1).join(" ");

	result = result.replace(/\$ARGUMENTS\b/g, () => sentinel(allArgs));
	result = result.replace(/\$@/g, () => sentinel(allArgs));

	// Cave-specific named variables.
	const namedVars: Record<string, string | undefined> = {
		CAVE_SESSION_ID: ctx.sessionId,
		CAVE_SKILL_DIR: ctx.skillDir,
		CAVE_EFFORT: ctx.effort,
	};

	result = result.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, varName) => {
		if (varName in namedVars && namedVars[varName] !== undefined) {
			return sentinel(namedVars[varName] as string);
		}
		const fromEnv = process.env[varName];
		return fromEnv !== undefined ? sentinel(fromEnv) : match;
	});

	// Restore sentinels.
	return result.replace(new RegExp(`${NUL}(\\d+)${NUL}`, "g"), (_, id) => sentinels[parseInt(id, 10)] ?? "");
}

/**
 * Apply inline shell preprocessing using Claude Code syntax: \`!`cmd`\`
 *
 * The pattern is a backtick-delimited literal whose first character is `!`.
 * When matched, the command runs in `cwd` (default 5s timeout) and its
 * stdout (trimmed) replaces the literal in the body. Failures keep the
 * literal in place with an inline error marker so the model still sees
 * something useful.
 */
export async function applyInlineShellPreprocessing(
	text: string,
	options: { cwd: string; timeoutMs?: number; shell?: string },
): Promise<{ content: string; results: Array<{ command: string; ok: boolean; output: string }> }> {
	const results: Array<{ command: string; ok: boolean; output: string }> = [];
	const matches: Array<{ start: number; end: number; command: string }> = [];

	// Find every `!`cmd`` occurrence. Backticks may not contain newlines.
	const regex = /`!([^`\n]+)`/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: classic regex iteration
	while ((m = regex.exec(text)) !== null) {
		matches.push({ start: m.index, end: m.index + m[0].length, command: m[1].trim() });
	}

	if (matches.length === 0) {
		return { content: text, results };
	}

	// Run all commands in parallel.
	const runs = await Promise.all(
		matches.map(async (match) => {
			try {
				const shell = options.shell || (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
				const shellArgs = process.platform === "win32" ? ["/c", match.command] : ["-c", match.command];
				const exec = await execCommand(shell, shellArgs, options.cwd, {
					timeout: options.timeoutMs ?? 5_000,
				});
				const ok = exec.code === 0;
				const output = (exec.stdout || "").trimEnd();
				results.push({ command: match.command, ok, output: output || (exec.stderr || "").trimEnd() });
				return {
					...match,
					replacement: ok ? output : `[!${match.command} failed: ${exec.stderr.trim() || `exit ${exec.code}`}]`,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				results.push({ command: match.command, ok: false, output: message });
				return { ...match, replacement: `[!${match.command} error: ${message}]` };
			}
		}),
	);

	// Splice replacements in reverse order so indices stay valid.
	let content = text;
	for (let i = runs.length - 1; i >= 0; i--) {
		const r = runs[i];
		content = content.slice(0, r.start) + r.replacement + content.slice(r.end);
	}

	return { content, results };
}

// =============================================================================
// WS5: Hot Reload Watcher
// =============================================================================

/**
 * Watch skill directories for changes and invoke a callback on add/remove/edit.
 *
 * The watcher is intentionally cheap: it watches each directory recursively
 * (Node's `recursive` flag is a no-op on Linux but works on macOS/Windows;
 * on Linux we fall back to a per-subdir watch lazily).
 *
 * Returns a `dispose()` callback that closes all watchers.
 */
export interface SkillWatcherOptions {
	/** Directories to watch. Non-existent ones are ignored. */
	dirs: string[];
	/** Called when any markdown file changes; receives the changed path. */
	onChange: (event: { path: string; eventType: "rename" | "change" }) => void;
	/** Debounce window (ms) — coalesce burst-of-saves. Default 150ms. */
	debounceMs?: number;
}

export function watchSkills(options: SkillWatcherOptions): { dispose: () => void } {
	const watchers: FSWatcher[] = [];
	const debounce = options.debounceMs ?? 150;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: { path: string; eventType: "rename" | "change" } | null = null;

	const flush = () => {
		if (pending) {
			const evt = pending;
			pending = null;
			timer = null;
			try {
				options.onChange(evt);
			} catch {
				// Listener errors must not kill the watcher.
			}
		}
	};

	const enqueue = (filename: string | null, eventType: "rename" | "change", baseDir: string) => {
		if (!filename) return;
		const fullPath = join(baseDir, filename);
		// Only react to markdown files (SKILL.md and command/*.md).
		if (!fullPath.endsWith(".md")) return;
		pending = { path: fullPath, eventType };
		if (timer) clearTimeout(timer);
		timer = setTimeout(flush, debounce);
	};

	for (const dir of options.dirs) {
		if (!existsSync(dir)) continue;
		try {
			const w = watch(dir, { recursive: true }, (event, filename) => {
				enqueue(filename ? String(filename) : null, event, dir);
			});
			watchers.push(w);
		} catch {
			// Some platforms reject `recursive: true`; fall back to a
			// non-recursive watch.
			try {
				const w = watch(dir, (event, filename) => {
					enqueue(filename ? String(filename) : null, event, dir);
				});
				watchers.push(w);
			} catch {
				// Give up on this dir.
			}
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
