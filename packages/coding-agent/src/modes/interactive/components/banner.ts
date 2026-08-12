import { readFile } from "node:fs/promises";
import { Container, Image, truncateToWidth, visibleWidth } from "@zhachory1/mewrite-tui";
import {
	BANNER_LOGO_MAX_WIDTH_CELLS,
	BANNER_LOGO_PATH,
	BANNER_PRIMARY_WORDMARK,
	BANNER_SECONDARY_WORDMARK,
	BANNER_TAGLINE,
} from "../../../config.js";
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

/** Pencil logo (code shaft). Terminal-safe box-drawing/blocks; no image component. */
export const PENCIL_LOGO: readonly string[] = [
	" ▗▄▄▖",
	" ▐░░▌",
	"╭┴──┴╮",
	"│ <> │",
	"│ {} │",
	"│ () │",
	"│ // │",
	"│ [] │",
	"│ ░░ │",
	"╰┬──┬╯",
	" ╲░░╱",
	"  ╲╱",
];

/**
 * Enforced bounds for a distribution's wordmark art (`branding.primaryWordmark` /
 * `secondaryWordmark`). The wordmark renders in a fixed box beside the pencil, so
 * downstream art must fit it; anything larger is a hard error (see
 * `assertWordmarkFits`) rather than silently clipped.
 *
 * - Rows: the primary alone, and primary+secondary combined, must each be within
 *   the pencil's height so the block stays vertically centered without overflow.
 * - Width: leaves room beside the 6-wide pencil (+3 gap) on an 80-column terminal.
 */
export const WORDMARK_MAX_ROWS = PENCIL_LOGO.length; // 12
export const WORDMARK_MAX_WIDTH = 40;

/**
 * Validate wordmark art against the fixed box. Throws a clear, dimension-named
 * error so a downstream distribution fails fast at first render instead of
 * shipping a clipped logo. Empty leading/trailing rows are allowed (they carry no
 * width) and count toward the row budget like any other line.
 */
export function assertWordmarkFits(rows: readonly string[], which: "primaryWordmark" | "secondaryWordmark"): void {
	if (rows.length > WORDMARK_MAX_ROWS) {
		throw new Error(
			`branding.${which} has ${rows.length} rows; the maximum is ${WORDMARK_MAX_ROWS}. ` +
				`The wordmark renders in a fixed box beside the pencil logo.`,
		);
	}
	for (let i = 0; i < rows.length; i++) {
		const w = visibleWidth(rows[i]);
		if (w > WORDMARK_MAX_WIDTH) {
			throw new Error(
				`branding.${which} row ${i + 1} is ${w} cells wide; the maximum is ${WORDMARK_MAX_WIDTH}. ` +
					`Shorten the art or split it across primary/secondary wordmarks.`,
			);
		}
	}
}

let wordmarkValidated = false;

/**
 * Render the pencil logo with the brand wordmark vertically centered to its
 * right. Shared by the interactive startup banner and the `mewrite agents` launch
 * header so the brand logo is identical.
 *
 * The wordmark comes from `branding.primaryWordmark` (default: the built-in
 * "Me Write Code" block). When `showSecondaryWordmark` is set (tall terminals) and
 * a `branding.secondaryWordmark` exists, it is stacked below the primary. This is
 * how distributions rebrand both the interactive banner and the agents view.
 *
 * Wordmark art must fit the enforced box (see `assertWordmarkFits`); combined
 * primary+secondary is also bounded so the stacked block never overflows.
 */
export function renderPencilLogo(width: number, showSecondaryWordmark = false): string[] {
	if (!wordmarkValidated) {
		assertWordmarkFits(BANNER_PRIMARY_WORDMARK, "primaryWordmark");
		assertWordmarkFits(BANNER_SECONDARY_WORDMARK, "secondaryWordmark");
		const combined = BANNER_PRIMARY_WORDMARK.length + BANNER_SECONDARY_WORDMARK.length;
		if (combined > WORDMARK_MAX_ROWS) {
			throw new Error(
				`branding.primaryWordmark + secondaryWordmark total ${combined} rows; the maximum is ${WORDMARK_MAX_ROWS}. ` +
					`They stack together on tall terminals.`,
			);
		}
		wordmarkValidated = true;
	}
	const logoW = Math.max(...PENCIL_LOGO.map((r) => visibleWidth(r)));
	const gap = "   ";
	const wordmark = showSecondaryWordmark
		? [...BANNER_PRIMARY_WORDMARK, ...BANNER_SECONDARY_WORDMARK]
		: BANNER_PRIMARY_WORDMARK;
	const textRows = wordmark.map((r) => theme.bold(theme.fg("accent", r)));
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
		const lines = renderPencilLogo(width, this.options.showSecondaryWordmark ?? false);
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
