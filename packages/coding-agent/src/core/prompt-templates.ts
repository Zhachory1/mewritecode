import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getPromptsDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.js";

/**
 * Represents a prompt template loaded from a markdown file
 */
export interface PromptTemplate {
	name: string;
	description: string;
	content: string;
	sourceInfo: SourceInfo;
	filePath: string; // Absolute path to the template file
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) {
		args.push(current);
	}

	return args;
}

/**
 * Substitute argument placeholders in template content
 * Supports:
 * - $1, $2, ... for positional args
 * - $@ and $ARGUMENTS for all args
 * - ${@:N} for args from Nth onwards (bash-style slicing)
 * - ${@:N:L} for L args starting from Nth
 *
 * Note: Replacement happens on the template string only. Argument values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
	let result = content;

	// Replace $1, $2, etc. with positional args FIRST (before wildcards)
	// This prevents wildcard replacement values containing $<digit> patterns from being re-substituted
	result = result.replace(/\$(\d+)/g, (_, num) => {
		const index = parseInt(num, 10) - 1;
		return args[index] ?? "";
	});

	// Replace ${@:start} or ${@:start:length} with sliced args (bash-style)
	// Process BEFORE simple $@ to avoid conflicts
	result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
		let start = parseInt(startStr, 10) - 1; // Convert to 0-indexed (user provides 1-indexed)
		// Treat 0 as 1 (bash convention: args start at 1)
		if (start < 0) start = 0;

		if (lengthStr) {
			const length = parseInt(lengthStr, 10);
			return args.slice(start, start + length).join(" ");
		}
		return args.slice(start).join(" ");
	});

	// Pre-compute all args joined (optimization)
	const allArgs = args.join(" ");

	// Replace $ARGUMENTS with all args joined (new syntax, aligns with Claude, Codex, OpenCode)
	result = result.replace(/\$ARGUMENTS/g, allArgs);

	// Replace $@ with all args joined (existing syntax)
	result = result.replace(/\$@/g, allArgs);

	return result;
}

function loadTemplateFromFile(filePath: string, sourceInfo: SourceInfo): PromptTemplate | null {
	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(rawContent);

		const name = basename(filePath).replace(/\.md$/, "");

		// Get description from frontmatter or first non-empty line
		let description = frontmatter.description || "";
		if (!description) {
			const firstLine = body.split("\n").find((line) => line.trim());
			if (firstLine) {
				// Truncate if too long
				description = firstLine.slice(0, 60);
				if (firstLine.length > 60) description += "...";
			}
		}

		return {
			name,
			description,
			content: body,
			sourceInfo,
			filePath,
		};
	} catch {
		return null;
	}
}

/**
 * Scan a directory for .md files (non-recursive) and load them as prompt templates.
 */
function loadTemplatesFromDir(dir: string, getSourceInfo: (filePath: string) => SourceInfo): PromptTemplate[] {
	const templates: PromptTemplate[] = [];

	if (!existsSync(dir)) {
		return templates;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a file
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			if (isFile && entry.name.endsWith(".md")) {
				const template = loadTemplateFromFile(fullPath, getSourceInfo(fullPath));
				if (template) {
					templates.push(template);
				}
			}
		}
	} catch {
		return templates;
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** Working directory for project-local templates. Default: process.cwd() */
	cwd?: string;
	/** Agent config directory for global templates. Default: from getPromptsDir() */
	agentDir?: string;
	/** Explicit prompt template paths (files or directories) */
	promptPaths?: string[];
	/** Include default prompt directories. Default: true */
	includeDefaults?: boolean;
}

function normalizePath(input: string): string {
	const trimmed = input.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
	return trimmed;
}

function resolvePromptPath(p: string, cwd: string): string {
	const normalized = normalizePath(p);
	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/{CONFIG_DIR_NAME}/prompts/
 * 3. Explicit prompt paths
 */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions = {}): PromptTemplate[] {
	const resolvedCwd = options.cwd ?? process.cwd();
	const resolvedAgentDir = options.agentDir ?? getPromptsDir();
	const promptPaths = options.promptPaths ?? [];
	const includeDefaults = options.includeDefaults ?? true;

	const templates: PromptTemplate[] = [];

	const globalPromptsDir = options.agentDir ? join(options.agentDir, "prompts") : resolvedAgentDir;
	const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSourceInfo = (resolvedPath: string): SourceInfo => {
		if (isUnderPath(resolvedPath, globalPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "user",
				baseDir: globalPromptsDir,
			});
		}
		if (isUnderPath(resolvedPath, projectPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "project",
				baseDir: projectPromptsDir,
			});
		}
		return createSyntheticSourceInfo(resolvedPath, {
			source: "local",
			baseDir: statSync(resolvedPath).isDirectory() ? resolvedPath : dirname(resolvedPath),
		});
	};

	if (includeDefaults) {
		templates.push(...loadTemplatesFromDir(globalPromptsDir, getSourceInfo));
		templates.push(...loadTemplatesFromDir(projectPromptsDir, getSourceInfo));
	}

	// 3. Load explicit prompt paths
	for (const rawPath of promptPaths) {
		const resolvedPath = resolvePromptPath(rawPath, resolvedCwd);
		if (!existsSync(resolvedPath)) {
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				templates.push(...loadTemplatesFromDir(resolvedPath, getSourceInfo));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const template = loadTemplateFromFile(resolvedPath, getSourceInfo(resolvedPath));
				if (template) {
					templates.push(template);
				}
			}
		} catch {
			// Ignore read failures
		}
	}

	return templates;
}

/** A recognized `/command` token located within a message. */
export interface CommandToken {
	name: string;
	/** Index of the leading `/`. */
	slashIndex: number;
	/** Index just past the end of the command name. */
	nameEnd: number;
}

// A command token is a `/name` at a word boundary (start-of-string or whitespace).
// Names allow letters, digits, `_`, `-`, and `:` (for the `skill:<name>` namespace).
// This boundary requirement is what keeps file paths (`/usr/bin`), URLs
// (`http://…`), and regexes (`s/foo/bar/`) from ever matching.
const COMMAND_TOKEN_RE = /(^|\s)(\/[A-Za-z0-9_:-]+)/g;

/**
 * Scan `text` for `/command` tokens at word boundaries whose name satisfies
 * `isCommand`. Tokens whose name is not recognized are ignored, so ordinary
 * slashes in prose/paths/URLs are never treated as commands.
 */
export function scanCommandTokens(text: string, isCommand: (name: string) => boolean): CommandToken[] {
	const tokens: CommandToken[] = [];
	COMMAND_TOKEN_RE.lastIndex = 0;
	let m = COMMAND_TOKEN_RE.exec(text);
	while (m !== null) {
		const slashIndex = m.index + m[1].length; // skip the boundary char (empty for ^, else the whitespace)
		const name = m[2].slice(1); // drop the leading "/"
		if (isCommand(name)) {
			tokens.push({ name, slashIndex, nameEnd: slashIndex + m[2].length });
		}
		m = COMMAND_TOKEN_RE.exec(text);
	}
	return tokens;
}

/**
 * Expand recognized `/command` tokens anywhere in the message (issue #2),
 * supporting multiple per message. Only tokens whose name satisfies
 * `isCommand` are touched — everything else (paths, URLs, code) is preserved.
 *
 * - A single recognized command at the FRONT keeps full argument substitution
 *   (args = the rest of the message) for backward compatibility.
 * - Otherwise each recognized token is expanded in place with no args, and the
 *   surrounding prose is preserved verbatim.
 */
export function expandInlineCommands(
	text: string,
	isCommand: (name: string) => boolean,
	expand: (name: string, argsString: string) => string,
): string {
	const tokens = scanCommandTokens(text, isCommand);
	if (tokens.length === 0) return text;

	// Front-anchored single command → classic arg-substitution behavior.
	if (tokens.length === 1 && text.slice(0, tokens[0].slashIndex).trim() === "") {
		const t = tokens[0];
		return text.slice(0, t.slashIndex) + expand(t.name, text.slice(t.nameEnd).trim());
	}

	// Positional / multiple → expand each token in place, no args, keep prose.
	let result = "";
	let cursor = 0;
	for (const t of tokens) {
		result += text.slice(cursor, t.slashIndex);
		result += expand(t.name, "");
		cursor = t.nameEnd;
	}
	result += text.slice(cursor);
	return result;
}

/**
 * Expand prompt templates referenced as `/name` anywhere in the text.
 * Returns the expanded content, or the original text if nothing matched.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	const byName = new Map(templates.map((t) => [t.name, t]));
	return expandInlineCommands(
		text,
		(name) => byName.has(name),
		(name, argsString) => {
			const template = byName.get(name);
			if (!template) return `/${name}`;
			return substituteArgs(template.content, parseCommandArgs(argsString));
		},
	);
}
