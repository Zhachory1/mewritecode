/**
 * #157 — Agent view transcript pane.
 *
 * Read-only, scrollable view of a single session's transcript. Opened from the
 * agent list (agents.ts) when a row is selected; `esc`/`q` returns to the list.
 * No input handoff — this pane never sends, interrupts, or approves.
 */

import {
	type Component,
	type Focusable,
	getKeybindings,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";

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

export class TranscriptView implements Component, Focusable {
	focused = true;
	private lines: TranscriptLine[] = [];
	private scroll = 0;
	private error: string | null = null;

	constructor(
		private readonly title: string,
		private readonly requestRender: () => void,
		private readonly onBack: () => void,
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
				for (const wrapped of wrapTextWithAnsi(line.text, Math.max(1, width - USER_PREFIX_WIDTH))) {
					out.push(truncateToWidth(prefix + wrapped, width));
				}
				continue;
			}
			const color = NON_TEXT_COLOR[line.role];
			for (const wrapped of wrapTextWithAnsi(line.text, width)) {
				const truncated = truncateToWidth(wrapped, width);
				out.push(color ? theme.fg(color, truncated) : truncated);
			}
		}
		return out;
	}

	private clampScroll(max: number): void {
		this.scroll = Math.min(Math.max(0, this.scroll), Math.max(0, max));
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.scroll -= 1;
			this.requestRender();
		} else if (kb.matches(data, "tui.select.down")) {
			this.scroll += 1;
			this.requestRender();
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.scroll -= 10;
			this.requestRender();
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.scroll += 10;
			this.requestRender();
		} else if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.select.confirm")) {
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
		} else {
			this.clampScroll(body.length - 1);
			lines.push(...body.slice(this.scroll));
		}
		lines.push("");
		lines.push(theme.fg("dim", "↑/↓ scroll · esc/q back"));
		return lines;
	}
}
