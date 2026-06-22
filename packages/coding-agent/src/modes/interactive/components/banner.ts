import { Container, Text, truncateToWidth } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";

// Retained for backwards-compatible call sites; the value is ignored.
export type BannerSprite = "rock" | "rock-eyes" | "rock-ascii";

export interface BannerOptions {
	version: string;
	model?: string;
	contextWindow?: string;
	effort?: string;
	cwd?: string;
	sprite?: BannerSprite;
	showSecondaryWordmark?: boolean;
}

const PRIMARY_WORDMARK: readonly string[] = [
	"██   ██ ███████     ██     ██ ██████  ██ ████████ ███████",
	"███ ███ ██          ██     ██ ██   ██ ██    ██    ██",
	"███████ █████       ██  █  ██ ██████  ██    ██    █████",
	"██ █ ██ ██           ██ █ ██  ██   ██ ██    ██    ██",
	"██   ██ ███████       █████   ██   ██ ██    ██    ███████",
];

const SECONDARY_WORDMARK: readonly string[] = [
	"",
	"           ▄████▄   ▒█████  ▓█████▄ ▓█████",
	"          ▒██▀ ▀█  ▒██▒  ██▒▒██▀ ██▌▓█   ▀",
	"          ▒▓█    ▄ ▒██░  ██▒░██   █▌▒███",
	"          ▒▓▓▄ ▄██▒▒██   ██░░██_  █▌▒▓█  ▄",
	"          ▒ ▓███▀ ░░ ████▓▒░░██████ ░▒████▒",
	"          ░ ░▒ ▒  ░░ ▒░▒░▒░ ░ ▒▒▓  ▒░░ ▒░ ░",
	"            ░  ▒     ░ ▒ ▒░ ░ ▒▒ ░  ░░ ░  ░",
	"          ░        ░ ░ ░ ▒  ░ ▒  ░     ░",
	"          ░ ░          ░ ░    ░        ░  ░",
	"          ░                 ░",
];

const WORDMARK_PRIMARY_ROWS = PRIMARY_WORDMARK.length;
const TAGLINE = "Any Model, Less Tokens, Code Good";

export class BannerComponent extends Container {
	constructor(options: BannerOptions) {
		super();
		const rows = options.showSecondaryWordmark ? [...PRIMARY_WORDMARK, ...SECONDARY_WORDMARK] : PRIMARY_WORDMARK;
		for (const [index, row] of rows.entries()) {
			const color = index < WORDMARK_PRIMARY_ROWS ? "accent" : "mdHeading";
			this.addChild(new Text(row ? theme.fg(color, row) : row, 1, 0));
		}
		this.addChild(new Text(theme.fg("dim", TAGLINE), 1, 0));
		const info = composeInfoLine(options);
		if (info) {
			this.addChild(new Text(info, 1, 0));
		}
	}
}

function composeInfoLine(options: BannerOptions): string {
	const cols = process.stdout.columns ?? 80;
	const budget = Math.max(20, cols - 2);
	const parts: string[] = [`v${options.version}`];
	const modelPart = formatModelLine(options.model, options.contextWindow, options.effort);
	if (modelPart) parts.push(modelPart);
	const cwd = formatCwd(options.cwd);
	if (cwd) parts.push(cwd);
	const text = parts.join("  ·  ");
	return theme.fg("dim", truncateToWidth(text, budget, "…"));
}

function formatModelLine(model: string | undefined, ctx: string | undefined, effort: string | undefined): string {
	if (!model) return "";
	const ctxPart = ctx ? ` (${ctx})` : "";
	const effortPart = effort ? ` · ${effort}` : "";
	return `${model}${ctxPart}${effortPart}`;
}

function formatCwd(cwd: string | undefined): string {
	if (!cwd) return "";
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}
