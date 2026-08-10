/**
 * #157 — Agent view transcript pane.
 *
 * Read-only, scrollable view of a single session's transcript. Opened from the
 * agent list (agents.ts) when a row is selected; `esc`/`q` returns to the list.
 * No input handoff — this pane never sends, interrupts, or approves.
 *
 * Message text is rendered as markdown (reusing the interactive Markdown
 * component). The view live-tails: it stays pinned to the newest content as new
 * turns arrive, unless the user has scrolled up, in which case the scroll
 * position is held.
 */

import {
	type Component,
	type Focusable,
	getKeybindings,
	Markdown,
	type MarkdownTheme,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@zhachory1/mewrite-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

export interface TranscriptLine {
	role: "user" | "assistant" | "toolResult" | "system" | "tool" | "error";
	text: string;
}

/** Columns consumed by the user-message accent prefix (`"│ "`). */
const USER_PREFIX_WIDTH = 2;

/** Non-user, non-assistant roles render dim (tool/system) or as a warning (error). */
const NON_TEXT_COLOR: Partial<Record<TranscriptLine["role"], Parameters<typeof theme.fg>[0]>> = {
	toolResult: "dim",
	tool: "dim",
	system: "dim",
	error: "warning",
};

/** Header + footer chrome lines that don't scroll. */
const CHROME_ROWS = 3;

export class TranscriptView implements Component, Focusable {
	focused = true;
	private lines: TranscriptLine[] = [];
	private error: string | null = null;
	/** Rows the body is scrolled up from the bottom. 0 = pinned to tail (follow). */
	private offsetFromBottom = 0;
	private readonly markdownTheme: MarkdownTheme = getMarkdownTheme();

	constructor(
		private readonly title: string,
		private readonly requestRender: () => void,
		private readonly onBack: () => void,
		/** Viewport height in rows; used to window the body for live-tail. */
		private readonly rows: () => number = () => process.stdout.rows || 24,
		/**
		 * When monitoring a running agent (#185 phase C+), controls to steer/interrupt
		 * it. Absent for read-only history of an idle/finished session.
		 */
		private readonly controls?: { onSteer: () => void; onInterrupt: () => void },
	) {}

	setLines(lines: TranscriptLine[]): void {
		this.lines = lines;
		this.error = null;
		this.requestRender();
	}

	setError(message: string): void {
		this.error = message;
		this.requestRender();
	}

	invalidate(): void {}

	private renderBody(width: number): string[] {
		const out: string[] = [];
		for (const line of this.lines) {
			if (out.length > 0) out.push("");
			if (line.role === "user") {
				// Accent left-bar prefix, matching interactive user messages.
				const prefix = `${theme.fg("accent", "│")} `;
				const md = new Markdown(line.text, 0, 0, this.markdownTheme);
				for (const rendered of md.render(Math.max(1, width - USER_PREFIX_WIDTH))) {
					out.push(truncateToWidth(prefix + rendered, width));
				}
				continue;
			}
			if (line.role === "assistant") {
				const md = new Markdown(line.text, 0, 0, this.markdownTheme);
				for (const rendered of md.render(width)) {
					out.push(truncateToWidth(rendered, width));
				}
				continue;
			}
			// Tool/system/error: plain, colored, no markdown.
			const color = NON_TEXT_COLOR[line.role];
			for (const wrapped of wrapTextWithAnsi(line.text, width)) {
				const truncated = truncateToWidth(wrapped, width);
				out.push(color ? theme.fg(color, truncated) : truncated);
			}
		}
		return out;
	}

	/** Number of body rows visible after subtracting fixed header/footer chrome. */
	private viewportBodyRows(): number {
		return Math.max(1, this.rows() - CHROME_ROWS);
	}

	private scrollBy(delta: number): void {
		this.offsetFromBottom = Math.max(0, this.offsetFromBottom - delta);
		this.requestRender();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.scrollBy(-1);
		} else if (kb.matches(data, "tui.select.down")) {
			this.scrollBy(1);
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.scrollBy(-this.viewportBodyRows());
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.scrollBy(this.viewportBodyRows());
		} else if (this.controls && kb.matches(data, "app.agents.steer")) {
			this.controls.onSteer();
		} else if (this.controls && kb.matches(data, "app.agents.interrupt")) {
			this.controls.onInterrupt();
		} else if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "app.agents.back")) {
			this.onBack();
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.bold(truncateToWidth(this.title, width)));
		if (this.error) {
			lines.push("");
			lines.push(theme.fg("warning", truncateToWidth(this.error, width)));
			lines.push("");
			lines.push(theme.fg("dim", "esc/q back"));
			return lines;
		}
		const body = this.renderBody(width);
		if (body.length === 0) {
			lines.push("");
			lines.push(theme.fg("dim", "No messages yet."));
			lines.push("");
			lines.push(theme.fg("dim", "esc/q back"));
			return lines;
		}

		// Live-tail window: show the last `viewport` rows, offset upward by
		// `offsetFromBottom`. offsetFromBottom==0 pins to the newest content.
		const viewport = this.viewportBodyRows();
		const maxOffset = Math.max(0, body.length - viewport);
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		const end = body.length - this.offsetFromBottom;
		const start = Math.max(0, end - viewport);
		lines.push(...body.slice(start, end));

		lines.push("");
		const following = this.offsetFromBottom === 0;
		const parts = ["↑/↓ scroll", "esc/q back"];
		if (this.controls) parts.push("s steer", "x stop");
		if (following) parts.push("following");
		lines.push(theme.fg("dim", parts.join(" · ")));
		return lines;
	}
}
