import { Container, Text, truncateToWidth } from "@juliusbrussee/caveman-tui";
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
}

// "Rokt Cave" rendered via figlet `small` font. Pure ASCII so it renders in
// every terminal without needing a non-UTF-8 fallback.
const WORDMARK: readonly string[] = [
	" ___     _   _      ___              ",
	"| _ \\___| |_| |_   / __|__ ___ _____ ",
	"|   / _ \\ / /  _| | (__/ _` \\ V / -_)",
	"|_|_\\___/_\\_\\\\__|  \\___\\__,_|\\_/\\___|",
];

export class BannerComponent extends Container {
	constructor(options: BannerOptions) {
		super();
		for (const row of WORDMARK) {
			this.addChild(new Text(theme.fg("accent", row), 1, 0));
		}
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
