/**
 * Render an `@xterm/headless` screen buffer to ANSI-styled lines for the TUI.
 *
 * `@xterm/headless` has no serialize addon, so we walk the active buffer cell by
 * cell and rebuild SGR sequences from each cell's attributes. Kept as a pure
 * function over a minimal cell/line/buffer shape so it can be unit-tested without
 * spawning a real terminal.
 */

/** Minimal subset of the xterm IBufferCell API we depend on. */
export interface PtyCell {
	getChars(): string;
	getWidth(): number;
	getFgColor(): number;
	getBgColor(): number;
	isFgRGB(): boolean;
	isBgRGB(): boolean;
	isFgPalette(): boolean;
	isBgPalette(): boolean;
	isFgDefault(): boolean;
	isBgDefault(): boolean;
	isBold(): number;
	isDim(): number;
	isItalic(): number;
	isUnderline(): number;
	isInverse(): number;
	isInvisible(): number;
}

export interface PtyLine {
	readonly length: number;
	getCell(x: number, cell?: PtyCell): PtyCell | undefined;
}

export interface PtyBuffer {
	/** First row of the live viewport within the scrollback (rows above are history). */
	readonly baseY: number;
	getLine(y: number): PtyLine | undefined;
}

const RESET = "\x1b[0m";

/** Style state that matters for coalescing runs; compared by equality. */
interface Style {
	fg: string; // SGR fg params, e.g. "38;5;208" or "" for default
	bg: string;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	inverse: boolean;
	invisible: boolean;
}

function fgParams(cell: PtyCell): string {
	if (cell.isFgDefault()) return "";
	const c = cell.getFgColor();
	if (cell.isFgRGB()) return `38;2;${(c >> 16) & 0xff};${(c >> 8) & 0xff};${c & 0xff}`;
	if (cell.isFgPalette()) return `38;5;${c}`;
	return "";
}

function bgParams(cell: PtyCell): string {
	if (cell.isBgDefault()) return "";
	const c = cell.getBgColor();
	if (cell.isBgRGB()) return `48;2;${(c >> 16) & 0xff};${(c >> 8) & 0xff};${c & 0xff}`;
	if (cell.isBgPalette()) return `48;5;${c}`;
	return "";
}

function styleOf(cell: PtyCell): Style {
	return {
		fg: fgParams(cell),
		bg: bgParams(cell),
		bold: cell.isBold() !== 0,
		dim: cell.isDim() !== 0,
		italic: cell.isItalic() !== 0,
		underline: cell.isUnderline() !== 0,
		inverse: cell.isInverse() !== 0,
		invisible: cell.isInvisible() !== 0,
	};
}

function sameStyle(a: Style, b: Style): boolean {
	return (
		a.fg === b.fg &&
		a.bg === b.bg &&
		a.bold === b.bold &&
		a.dim === b.dim &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.inverse === b.inverse &&
		a.invisible === b.invisible
	);
}

function sgrFor(style: Style): string {
	const parts: string[] = [];
	if (style.bold) parts.push("1");
	if (style.dim) parts.push("2");
	if (style.italic) parts.push("3");
	if (style.underline) parts.push("4");
	if (style.inverse) parts.push("7");
	if (style.invisible) parts.push("8");
	if (style.fg) parts.push(style.fg);
	if (style.bg) parts.push(style.bg);
	return parts.length ? `\x1b[${parts.join(";")}m` : "";
}

/** A cell is visible if it has a non-space glyph or a non-default background. */
function isVisible(cell: PtyCell): boolean {
	const ch = cell.getChars();
	if (ch !== "" && ch !== " ") return true;
	return !cell.isBgDefault();
}

/**
 * Last column index (exclusive) worth rendering: trims trailing blank, default-
 * background padding cells but keeps colored spaces and real trailing content.
 */
function lastVisibleCol(line: PtyLine, cols: number): number {
	for (let x = cols - 1; x >= 0; x--) {
		const cell = line.getCell(x);
		if (cell && cell.getWidth() > 0 && isVisible(cell)) return x + 1;
	}
	return 0;
}

/** Render a single buffer row [0, cols) to an ANSI string, trailing blanks trimmed. */
export function renderLine(line: PtyLine | undefined, cols: number): string {
	if (!line) return "";
	const limit = lastVisibleCol(line, cols);
	if (limit === 0) return "";
	let out = "";
	let open: Style | null = null;
	let pending = "";

	const flushRun = (style: Style): void => {
		if (pending === "") return;
		out += sgrFor(style) + pending + (sgrFor(style) ? RESET : "");
		pending = "";
	};

	for (let x = 0; x < limit; ) {
		const cell = line.getCell(x);
		if (!cell) break;
		const w = cell.getWidth();
		if (w === 0) {
			// Spacer cell following a wide glyph; skip.
			x += 1;
			continue;
		}
		const chars = cell.getChars() || " ";
		const style = styleOf(cell);
		if (open === null) {
			open = style;
		} else if (!sameStyle(open, style)) {
			flushRun(open);
			open = style;
		}
		pending += chars;
		x += w;
	}
	if (open) flushRun(open);
	return out;
}

/**
 * Render the live viewport ([baseY, baseY+rows)) of a buffer to ANSI-styled
 * lines. Reading from `baseY` (not 0) tracks the terminal as it scrolls; rows
 * above `baseY` are scrollback history the emulator has already pushed up.
 */
export function renderBuffer(buffer: PtyBuffer, rows: number, cols: number): string[] {
	const lines: string[] = [];
	for (let y = 0; y < rows; y++) {
		lines.push(renderLine(buffer.getLine(buffer.baseY + y), cols));
	}
	return lines;
}
