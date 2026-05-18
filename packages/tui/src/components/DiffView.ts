/**
 * Diff view — side-by-side ≥ 100 cols, unified otherwise.
 *
 * Implements the "Diff rendering: side-by-side ≥ 100 cols, unified otherwise,
 * AAA contrast" deliverable from WS10. This component takes a pre-computed
 * line diff (additions / deletions / context) and lays it out for a given
 * terminal width. Hunk parsing is the caller's job — the existing edit-format
 * renderers in `coding-agent/src/core/edit-formats/` (WS8 territory) will
 * produce these line-tagged inputs.
 */
import type { Component } from "../tui.js";
import { truncateToWidth, visibleWidth } from "../utils.js";

export type DiffLineKind = "context" | "add" | "del" | "header" | "hunk";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	oldLine?: number;
	newLine?: number;
}

export interface DiffViewTheme {
	add: (text: string) => string;
	del: (text: string) => string;
	context: (text: string) => string;
	header: (text: string) => string;
	hunk: (text: string) => string;
	gutterAdd: (text: string) => string;
	gutterDel: (text: string) => string;
	gutterContext: (text: string) => string;
	separator: (text: string) => string;
}

const IDENTITY_THEME: DiffViewTheme = {
	add: (s) => s,
	del: (s) => s,
	context: (s) => s,
	header: (s) => s,
	hunk: (s) => s,
	gutterAdd: (s) => s,
	gutterDel: (s) => s,
	gutterContext: (s) => s,
	separator: (s) => s,
};

/** Threshold below which we render unified rather than side-by-side. */
export const SIDE_BY_SIDE_MIN_WIDTH = 100;

export type DiffLayout = "unified" | "side-by-side";

export function pickLayout(width: number): DiffLayout {
	return width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "unified";
}

export interface DiffViewOptions {
	lines: DiffLine[];
	theme?: DiffViewTheme;
	/** Force a specific layout. Default: width-based per `pickLayout`. */
	forceLayout?: DiffLayout;
	/** Show line-number gutter. */
	showLineNumbers?: boolean;
}

export class DiffView implements Component {
	private lines: DiffLine[];
	private theme: DiffViewTheme;
	private forceLayout?: DiffLayout;
	private showLineNumbers: boolean;

	constructor(options: DiffViewOptions) {
		this.lines = options.lines;
		this.theme = options.theme ?? IDENTITY_THEME;
		this.forceLayout = options.forceLayout;
		this.showLineNumbers = options.showLineNumbers ?? true;
	}

	setLines(lines: DiffLine[]): void {
		this.lines = lines;
	}

	invalidate(): void {
		// Stateless — recomputed each render call.
	}

	render(width: number): string[] {
		const layout = this.forceLayout ?? pickLayout(width);
		return layout === "side-by-side" ? this.renderSideBySide(width) : this.renderUnified(width);
	}

	private renderUnified(width: number): string[] {
		const out: string[] = [];
		const gutterW = this.showLineNumbers ? 5 : 0;
		const sepW = 1; // " "
		const prefixW = 1; // "+", "-", " "
		const contentW = Math.max(1, width - gutterW - sepW - prefixW);

		for (const line of this.lines) {
			if (line.kind === "header") {
				out.push(this.theme.header(padToWidth(truncateToWidth(line.text, width), width)));
				continue;
			}
			if (line.kind === "hunk") {
				out.push(this.theme.hunk(padToWidth(truncateToWidth(line.text, width), width)));
				continue;
			}
			const gutter = this.showLineNumbers ? this.formatGutter(line.oldLine, line.newLine, line.kind) : "";
			const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
			const body = truncateToWidth(line.text, contentW);

			let row = `${gutter}${prefix} ${body}`;
			row = padToWidth(row, width);
			row = applyKind(row, line.kind, this.theme);
			out.push(row);
		}
		return out;
	}

	private renderSideBySide(width: number): string[] {
		const sepW = 3; // " │ "
		const colW = Math.floor((width - sepW) / 2);
		const out: string[] = [];
		const pairs = pairUpHunks(this.lines);

		for (const pair of pairs) {
			if (pair.kind === "header") {
				out.push(this.theme.header(padToWidth(truncateToWidth(pair.text, width), width)));
				continue;
			}
			if (pair.kind === "hunk") {
				out.push(this.theme.hunk(padToWidth(truncateToWidth(pair.text, width), width)));
				continue;
			}
			const left = pair.left ? this.formatHalf(pair.left, colW) : padToWidth("", colW);
			const right = pair.right ? this.formatHalf(pair.right, colW) : padToWidth("", colW);
			const sep = this.theme.separator(" │ ");
			out.push(`${left}${sep}${right}`);
		}
		return out;
	}

	private formatHalf(line: DiffLine, colW: number): string {
		const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
		const body = truncateToWidth(line.text, Math.max(1, colW - 2));
		const row = padToWidth(`${prefix} ${body}`, colW);
		return applyKind(row, line.kind, this.theme);
	}

	private formatGutter(oldLine: number | undefined, newLine: number | undefined, kind: DiffLineKind): string {
		const o = oldLine !== undefined ? String(oldLine) : "";
		const n = newLine !== undefined ? String(newLine) : "";
		const cell = kind === "add" ? n : kind === "del" ? o : n || o;
		return `${cell.padStart(4, " ")} `;
	}
}

function applyKind(row: string, kind: DiffLineKind, theme: DiffViewTheme): string {
	switch (kind) {
		case "add":
			return theme.add(row);
		case "del":
			return theme.del(row);
		case "context":
			return theme.context(row);
		case "header":
			return theme.header(row);
		case "hunk":
			return theme.hunk(row);
	}
}

function padToWidth(s: string, width: number): string {
	const w = visibleWidth(s);
	if (w >= width) return s;
	return s + " ".repeat(width - w);
}

interface DiffPair {
	kind: DiffLineKind;
	text: string;
	left?: DiffLine;
	right?: DiffLine;
}

/**
 * Pair up consecutive del/add runs for side-by-side layout. Within a hunk:
 *
 *   [del A, del B, add C, add D, ctx X]
 *
 * becomes:
 *
 *   [del A | add C, del B | add D, ctx X | ctx X]
 *
 * Mismatched lengths are padded with empty halves.
 */
export function pairUpHunks(lines: DiffLine[]): DiffPair[] {
	const out: DiffPair[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.kind === "header") {
			out.push({ kind: "header", text: line.text });
			i++;
			continue;
		}
		if (line.kind === "hunk") {
			out.push({ kind: "hunk", text: line.text });
			i++;
			continue;
		}
		if (line.kind === "context") {
			out.push({ kind: "context", text: line.text, left: line, right: line });
			i++;
			continue;
		}

		// Collect run of dels then adds.
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < lines.length && lines[i].kind === "del") {
			dels.push(lines[i]);
			i++;
		}
		while (i < lines.length && lines[i].kind === "add") {
			adds.push(lines[i]);
			i++;
		}
		const max = Math.max(dels.length, adds.length);
		for (let k = 0; k < max; k++) {
			const left = dels[k];
			const right = adds[k];
			const kind: DiffLineKind = left ? "del" : "add";
			out.push({ kind, text: (left ?? right ?? { text: "" }).text, left, right });
		}
	}
	return out;
}
