import { readFile } from "node:fs/promises";
import { Container, Image, truncateToWidth, visibleWidth } from "@zhachory1/mewrite-tui";
import { BANNER_LOGO_MAX_WIDTH_CELLS, BANNER_LOGO_PATH, BANNER_TAGLINE } from "../../../config.js";
import { detectSupportedImageMimeTypeFromFile } from "../../../utils/mime.js";
import { theme } from "../theme/theme.js";

// Retained for backwards-compatible call sites; the value is ignored.
export type BannerSprite = "rock" | "rock-eyes" | "rock-ascii";

export interface BannerLogo {
	base64Data: string;
	mimeType: string;
	filename: string;
	maxWidthCells?: number;
}

export interface BannerOptions {
	version: string;
	model?: string;
	contextWindow?: string;
	effort?: string;
	cwd?: string;
	sprite?: BannerSprite;
	showSecondaryWordmark?: boolean;
	logo?: BannerLogo;
}

/** Pencil logo (code shaft). Terminal-safe box-drawing; no image component. */
export const PENCIL_LOGO: readonly string[] = [
	" (░▒░)",
	" │▒▒▒│",
	"╭┴───┴╮",
	"│ < > │",
	"│ { } │",
	"│ ( ) │",
	"│ / / │",
	"│ [ ] │",
	"│ ░ ░ │",
	"╰┬───┬╯",
	" \\░░░/",
	"  \\█/",
	"   ▼",
];

const BRAND_TITLE = "Me Write Code";
const BRAND_TAGLINES = ["me write less,", "me do more"];

/**
 * Render the pencil logo with the brand text (title, blank line, taglines)
 * vertically centered to its right. Shared by the interactive startup banner and
 * the `mewrite agents` launch header so the brand logo is identical.
 */
export function renderPencilLogo(width: number): string[] {
	const logoW = Math.max(...PENCIL_LOGO.map((r) => visibleWidth(r)));
	const gap = "   ";
	const textRows = [
		theme.bold(theme.fg("accent", BRAND_TITLE)),
		"",
		theme.fg("dim", BRAND_TAGLINES[0]),
		theme.fg("dim", BRAND_TAGLINES[1]),
	];
	const textStart = Math.max(0, Math.floor((PENCIL_LOGO.length - textRows.length) / 2));
	return PENCIL_LOGO.map((row, i) => {
		const pad = " ".repeat(Math.max(0, logoW - visibleWidth(row)));
		const logo = theme.fg("accent", row) + pad;
		const textIdx = i - textStart;
		const text = textIdx >= 0 && textIdx < textRows.length ? gap + textRows[textIdx] : "";
		return truncateToWidth(logo + text, width);
	});
}

export async function loadBannerLogo(): Promise<BannerLogo | undefined> {
	if (!BANNER_LOGO_PATH) return undefined;
	try {
		const mimeType = await detectSupportedImageMimeTypeFromFile(BANNER_LOGO_PATH);
		if (!mimeType) return undefined;
		const data = await readFile(BANNER_LOGO_PATH);
		return {
			base64Data: data.toString("base64"),
			mimeType,
			filename: BANNER_LOGO_PATH,
			maxWidthCells: BANNER_LOGO_MAX_WIDTH_CELLS,
		};
	} catch {
		return undefined;
	}
}

export class BannerComponent extends Container {
	private options: BannerOptions;

	constructor(options: BannerOptions) {
		super();
		this.options = options;
		if (options.logo) {
			this.addChild(
				new Image(
					options.logo.base64Data,
					options.logo.mimeType,
					{ fallbackColor: (text) => theme.fg("dim", text) },
					{ maxWidthCells: options.logo.maxWidthCells, filename: options.logo.filename },
				),
			);
		}
	}

	render(width: number): string[] {
		// Image logo (if branded) keeps its own layout + tagline; otherwise render the
		// pencil logo, which already carries the brand title + taglines to its right.
		if (this.options.logo) {
			const lines = super.render(width);
			lines.push(` ${theme.fg("dim", BANNER_TAGLINE)}`);
			const info = composeInfoLine(this.options);
			if (info) lines.push(` ${info}`);
			return lines;
		}
		const lines = renderPencilLogo(width);
		const info = composeInfoLine(this.options);
		if (info) lines.push(` ${info}`);
		return lines;
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
