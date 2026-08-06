/**
 * #157 — Agent view transcript pane.
 *
 * Read-only, scrollable view of a single session's transcript. Opened from the
 * agent list (agents.ts) when a row is selected; `esc`/`q` returns to the list.
 * No input handoff — this pane never sends, interrupts, or approves.
 */

import { type Component, type Focusable, getKeybindings, wrapTextWithAnsi } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";

export interface TranscriptLine {
	role: "user" | "assistant" | "toolResult" | "system" | "tool" | "error";
	text: string;
}

const ROLE_LABEL: Record<TranscriptLine["role"], string> = {
	user: "you",
	assistant: "agent",
	toolResult: "tool",
	tool: "tool",
	system: "system",
	error: "error",
};

const ROLE_COLOR: Record<TranscriptLine["role"], Parameters<typeof theme.fg>[0]> = {
	user: "accent",
	assistant: "text",
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
			const label = ROLE_LABEL[line.role] ?? line.role;
			const color = ROLE_COLOR[line.role] ?? "text";
			for (const wrapped of wrapTextWithAnsi(line.text, width)) {
				out.push(theme.fg(color, `${label.padEnd(6)} ${wrapped}`));
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
		lines.push(theme.bold(this.title));
		if (this.error) {
			lines.push("");
			lines.push(theme.fg("warning", this.error));
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
