import { Container, Text, truncateToWidth, visibleWidth } from "@caveman-code/tui";
import { theme } from "../theme/theme.js";

export type BannerSprite = "rock" | "rock-eyes" | "rock-ascii";

export interface BannerOptions {
	version: string;
	model?: string;
	contextWindow?: string;
	effort?: string;
	cwd?: string;
	sprite?: BannerSprite;
}

const SPRITES: Record<BannerSprite, readonly string[]> = {
	rock: [" ▄████▄ ", "████████", "▀██████▀"],
	"rock-eyes": [" ▄████▄ ", "██●  ●██", "▀██████▀"],
	"rock-ascii": [" _####_ ", "|#    #|", " \\####/ "],
};

const SPRITE_WIDTH = 8;
const GAP = "   ";

export class BannerComponent extends Container {
	constructor(options: BannerOptions) {
		super();
		const sprite = options.sprite ?? autoDetectSprite();
		const frames = SPRITES[sprite];

		const lines = composeLines(frames, options);
		for (const line of lines) {
			this.addChild(new Text(line, 1, 0));
		}
	}
}

function composeLines(spriteRows: readonly string[], options: BannerOptions): string[] {
	const right = composeRightColumn(options);
	const lines: string[] = [];
	for (let i = 0; i < spriteRows.length; i++) {
		const sprite = theme.fg("accent", spriteRows[i]);
		const rightText = right[i] ?? "";
		lines.push(`${sprite}${GAP}${rightText}`);
	}
	return lines;
}

function composeRightColumn(options: BannerOptions): string[] {
	const title = `Cave  v${options.version}`;
	const modelLine = formatModelLine(options.model, options.contextWindow, options.effort);
	const cwd = formatCwd(options.cwd);
	const cols = process.stdout.columns ?? 80;
	const budget = Math.max(20, cols - SPRITE_WIDTH - GAP.length - 2);

	return [
		theme.bold(theme.fg("accent", truncateToWidth(title, budget, "…"))),
		theme.fg("dim", truncateToWidth(modelLine, budget, "…")),
		theme.fg("dim", truncateLeft(cwd, budget)),
	];
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

function truncateLeft(text: string, budget: number): string {
	if (visibleWidth(text) <= budget) return text;
	const tailBudget = Math.max(1, budget - 1);
	const tail = text.slice(Math.max(0, text.length - tailBudget));
	return `…${tail}`;
}

function autoDetectSprite(): BannerSprite {
	const term = process.env.TERM ?? "";
	const lang = process.env.LANG ?? process.env.LC_ALL ?? "";
	if (term === "dumb" || term === "linux") return "rock-ascii";
	if (lang && !/utf-?8/i.test(lang)) return "rock-ascii";
	return "rock";
}
