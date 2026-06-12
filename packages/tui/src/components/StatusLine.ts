/**
 * Status line — Claude Code v2.1.119 compatible.
 *
 * Schema (from `settings.json`):
 *
 *   {
 *     "statusLine": {
 *       "type": "command" | "default" | "detailed",
 *       "command": "/path/to/script.sh",   // when type === "command"
 *       "padding": 0
 *     }
 *   }
 *
 * When `type === "command"`, cave invokes the binary with a JSON context
 * payload on stdin and renders stdout (single-line, ANSI-stripped to
 * terminal width). The schema is identical to Claude Code so a user pasting
 * `~/.claude/settings.json#statusLine` into `~/.cave/settings.json` Just
 * Works.
 */
import type { Component } from "../tui.js";
import { truncateToWidth, visibleWidth } from "../utils.js";

/**
 * Claude-Code-shaped statusLine setting. The `type` field is the union
 * authority; unknown types fall back to "default".
 */
export interface StatusLineSettings {
	type?: "command" | "default" | "detailed";
	/** Shell command to run (only when `type === "command"`). */
	command?: string;
	/** Left padding in cells. */
	padding?: number;
}

/**
 * JSON context that cave pipes to a `command`-type status line on stdin.
 * Matches Claude Code's documented shape closely enough that scripts written
 * for Claude Code work with cave (and vice versa).
 */
export interface StatusLineContext {
	hook_event_name: "Status";
	session_id: string;
	transcript_path?: string;
	cwd: string;
	model: { id: string; display_name?: string };
	workspace: { current_dir: string; project_dir: string };
	version?: string;
	output_style?: { name: string };
	cost?: { total_cost_usd: number; total_duration_ms: number };
	exceeds_200k_tokens?: boolean;
	/** Cave-specific extras. Claude Code ignores keys it doesn't know. */
	cave?: {
		branch?: string;
		gitDirty?: boolean;
		queuedMessages?: number;
		tokensIn?: number;
		tokensOut?: number;
		/** Savings Meter (DD §10.8): caveman bytes eliminated this session. */
		savedBytes?: number;
	};
}

/** Result of rendering — separated from Component so callers can compose. */
export interface StatusLineResult {
	text: string;
	/** Where the text came from. Useful for surfacing errors in /doctor. */
	source: "default" | "detailed" | "command" | "command-failed";
	stderr?: string;
}

/**
 * Build the default (terse) status line. Format:
 *   <model> · <cwd-tail>
 */
export function renderDefault(ctx: StatusLineContext): string {
	const model = ctx.model.display_name ?? ctx.model.id;
	return `${model} · ${tailPath(ctx.workspace.current_dir, 2)}`;
}

/**
 * Build the detailed status line. Format:
 *   <model> · <branch>(<dirty>) · <cwd-tail> · q:<n> · $<cost>
 */
export function renderDetailed(ctx: StatusLineContext): string {
	const parts: string[] = [];
	const model = ctx.model.display_name ?? ctx.model.id;
	parts.push(model);

	const branch = ctx.cave?.branch;
	if (branch) {
		parts.push(`${branch}${ctx.cave?.gitDirty ? "*" : ""}`);
	}

	parts.push(tailPath(ctx.workspace.current_dir, 2));

	const queued = ctx.cave?.queuedMessages ?? 0;
	if (queued > 0) parts.push(`q:${queued}`);

	const savedBytes = ctx.cave?.savedBytes ?? 0;
	if (savedBytes > 0) parts.push(`saved ${formatSavedBytes(savedBytes)}`);

	if (ctx.cost && ctx.cost.total_cost_usd > 0) {
		parts.push(`$${ctx.cost.total_cost_usd.toFixed(4)}`);
	}

	if (ctx.exceeds_200k_tokens) parts.push("⚠ 200k");

	return parts.join(" · ");
}

/** Compact saved-bytes for the status line: 940 → "940B", 4200 → "4kB", 1.5M → "1.4MB". */
function formatSavedBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)}kB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Truncate a filesystem path to the trailing N components.
 *
 *   tailPath("/a/b/c/d", 2) → "c/d"
 *   tailPath("/usr", 2)     → "/usr"
 */
export function tailPath(path: string, components: number): string {
	if (!path) return "";
	const parts = path.split(/[\\/]/).filter(Boolean);
	if (parts.length <= components) return path;
	return parts.slice(-components).join("/");
}

/**
 * Resolve a status line settings block to text. Synchronous helpers only —
 * the `command` type is async and lives on the StatusLine component below.
 */
export function renderStatusLineSync(settings: StatusLineSettings, ctx: StatusLineContext): StatusLineResult {
	const type = settings.type ?? "default";
	if (type === "detailed") return { text: renderDetailed(ctx), source: "detailed" };
	if (type === "command") {
		// Sync caller cannot run the command; surface the default.
		return { text: renderDefault(ctx), source: "default" };
	}
	return { text: renderDefault(ctx), source: "default" };
}

/**
 * Validate and coerce an unknown settings.json `statusLine` value into a
 * concrete StatusLineSettings. Returns `undefined` only when the value is
 * malformed in a way that cannot be safely rendered.
 */
export function parseStatusLineSettings(raw: unknown): StatusLineSettings | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const o = raw as Record<string, unknown>;

	const out: StatusLineSettings = {};

	if (typeof o.type === "string") {
		if (o.type === "command" || o.type === "default" || o.type === "detailed") {
			out.type = o.type;
		} else {
			out.type = "default";
		}
	}
	if (typeof o.command === "string" && o.command.trim().length > 0) {
		out.command = o.command;
	}
	if (typeof o.padding === "number" && Number.isFinite(o.padding) && o.padding >= 0) {
		out.padding = Math.floor(o.padding);
	}

	// If type is "command" but no command field, downgrade to "default".
	if (out.type === "command" && !out.command) {
		out.type = "default";
	}

	return out;
}

export interface StatusLineRenderer {
	/**
	 * Async render — runs the configured command if any. Implementations are
	 * provided by the coding-agent (which has access to bash-executor); the
	 * TUI component takes a renderer and only does layout.
	 */
	render(ctx: StatusLineContext): Promise<StatusLineResult>;
}

export interface StatusLineComponentTheme {
	bg: (text: string) => string;
	muted: (text: string) => string;
	error: (text: string) => string;
}

const IDENTITY_THEME: StatusLineComponentTheme = {
	bg: (s) => s,
	muted: (s) => s,
	error: (s) => s,
};

/**
 * Single-line status component. Renders the current cached text. Callers
 * call `setText()` when the renderer produces a new result.
 */
export class StatusLine implements Component {
	private text = "";
	private source: StatusLineResult["source"] = "default";
	private theme: StatusLineComponentTheme;
	private padding: number;

	constructor(options: { theme?: StatusLineComponentTheme; padding?: number } = {}) {
		this.theme = options.theme ?? IDENTITY_THEME;
		this.padding = options.padding ?? 0;
	}

	setText(result: StatusLineResult): void {
		this.text = sanitizeOneLine(result.text);
		this.source = result.source;
	}

	invalidate(): void {
		// Stateless render — nothing to clear.
	}

	render(width: number): string[] {
		const pad = " ".repeat(this.padding);
		const inner = `${pad}${this.text}`;
		const truncated = truncateToWidth(inner, width);
		// Pad to width so the status line owns its row even with diff backgrounds.
		const w = visibleWidth(truncated);
		const padded = w < width ? truncated + " ".repeat(width - w) : truncated;
		const styled = this.source === "command-failed" ? this.theme.error(padded) : this.theme.bg(padded);
		return [styled];
	}
}

/** Strip newlines/carriage returns; status line is single-row by contract. */
export function sanitizeOneLine(s: string): string {
	return s.replace(/[\r\n]+/g, " ").trim();
}
