import { readFile } from "node:fs/promises";
import { Container, Image, truncateToWidth, visibleWidth } from "@zhachory1/mewrite-tui";
import {
	BANNER_LOGO_MAX_WIDTH_CELLS,
	BANNER_LOGO_PATH,
	BANNER_PRIMARY_WORDMARK,
	BANNER_SECONDARY_WORDMARK,
	BANNER_TAGLINE,
	BANNER_WORDMARK_IS_CUSTOM,
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
 * Bounds for the *built-in default* wordmark that renders in a fixed box beside
 * the pencil. A distribution that sets `branding.primaryWordmark` renders its art
 * standalone (no pencil) and is not subject to this box — only the terminal width
 * bounds it. These constants exist to guard the built-in default (and any test
 * that opts into the box) so it stays within the pencil's footprint.
 *
 * - Rows: primary alone, and primary+secondary combined, within the pencil height.
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

function validateDefaultWordmarkOnce(): void {
	if (wordmarkValidated) return;
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

/** The wordmark rows to show, primary plus secondary when tall terminals allow. */
function wordmarkRows(showSecondaryWordmark: boolean): readonly string[] {
	return showSecondaryWordmark ? [...BANNER_PRIMARY_WORDMARK, ...BANNER_SECONDARY_WORDMARK] : BANNER_PRIMARY_WORDMARK;
}

/**
 * Render a distribution's custom wordmark art standalone — no pencil. Used when
 * `branding.primaryWordmark` is set: the wordmark replaces the built-in mark
 * entirely rather than sitting beside it, so a distribution presents its own
 * identity. Only bounded by the terminal width (each row is truncated); the
 * fixed pencil box does not apply since there is no pencil.
 */
function renderStandaloneWordmark(width: number, showSecondaryWordmark: boolean): string[] {
	return wordmarkRows(showSecondaryWordmark).map((r) => truncateToWidth(theme.bold(theme.fg("accent", r)), width));
}

/**
 * Render the brand logo for the interactive startup banner and the `mewrite
 * agents` launch header (shared so both are identical).
 *
 * - Upstream / no `branding.primaryWordmark`: the built-in pencil with the
 *   "Me Write Code" block wordmark centered to its right. The default wordmark is
 *   validated once against the fixed box (see `assertWordmarkFits`).
 * - A distribution that sets `branding.primaryWordmark`: that art renders
 *   standalone (no pencil), bounded only by the terminal width. `secondaryWordmark`
 *   stacks below on tall terminals in both modes.
 *
 * (A `branding.logoPath` image, handled by the caller, takes precedence over
 * either wordmark path.)
 */
export function renderPencilLogo(width: number, showSecondaryWordmark = false): string[] {
	if (BANNER_WORDMARK_IS_CUSTOM) {
		return renderStandaloneWordmark(width, showSecondaryWordmark);
	}
	validateDefaultWordmarkOnce();
	const logoW = Math.max(...PENCIL_LOGO.map((r) => visibleWidth(r)));
	const gap = "   ";
	const textRows = wordmarkRows(showSecondaryWordmark).map((r) => theme.bold(theme.fg("accent", r)));
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
