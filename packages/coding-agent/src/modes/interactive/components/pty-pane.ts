/**
 * Live PTY pane for the agents view.
 *
 * A thin focus-pane view over a `LivePtyAgent` (which owns the pty + emulator so
 * output keeps accumulating while this pane is closed). Keystrokes are forwarded
 * straight to the child's interactive UI — no steer modal, no read-only tail.
 */

import { type Component, type Focusable, truncateToWidth } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import type { LivePtyAgent } from "./pty-agent.js";
import { renderBuffer } from "./pty-render.js";

/** Header line above the pty grid. */
const HEADER_ROWS = 1;

/**
 * Kitty-protocol Escape: `CSI 27 [;<mods>] [:<event>] u`. Matches all modifier and
 * event-type (press/repeat/release) variants. Deliberately does NOT match other
 * CSI-u keys.
 */
const KITTY_ESCAPE = /^\x1b\[27(?:;\d+)?(?::\d+)?u$/;

/**
 * True for a lone Escape keypress: raw ESC, or any kitty-protocol esc form. NOT
 * true for ESC-prefixed sequences (arrows/alt/CSI). Used only once the agent has
 * exited (esc/q leave the pane); while the agent runs, esc is forwarded so it can
 * cancel the agent's turn.
 */
function isBareEscape(data: string): boolean {
	return data === "\x1b" || KITTY_ESCAPE.test(data);
}

export class PtyPane implements Component, Focusable {
	focused = true;

	constructor(
		private readonly title: string,
		private readonly agent: LivePtyAgent,
		requestRender: () => void,
		private readonly onBack: () => void,
		/** Viewport height in rows for the whole pane (header + grid). */
		private readonly viewportRows: () => number,
	) {
		// Drive re-renders from this agent's output while the pane is open.
		this.agent.setRenderCallback(requestRender);
	}

	private gridRows(): number {
		return Math.max(1, this.viewportRows() - HEADER_ROWS);
	}

	handleInput(data: string): void {
		// While the agent runs, esc is FORWARDED: inside interactive mewrite esc is
		// "cancel the current turn", and intercepting it here made stopping a thinking
		// agent impossible (the pane exit always won). Leaving a live pane is ctrl+w,
		// which TwoPaneView intercepts before input reaches this pane. Once the agent
		// has exited there is nothing to cancel, so esc (or q) leaves the pane.
		if (this.agent.exited) {
			if (isBareEscape(data) || data === "q") this.onBack();
			return;
		}
		this.agent.write(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const rows = this.gridRows();
		this.agent.resize(width, rows);
		const hint = theme.fg("dim", "  (ctrl+w to leave · esc stops the agent)");
		const header = truncateToWidth(theme.bold(this.title) + hint, width);
		// The embedded emulator (@xterm/headless, Unicode v6) and the TUI's
		// visibleWidth() (RGI emoji) disagree on some glyph widths (e.g. ✅ is 1 vs 2),
		// so a grid line that fills the child's columns can measure wider than `width`
		// to the outer renderer. Clamp each line so doRender's width invariant holds.
		const grid = renderBuffer(this.agent.buffer, rows, this.agent.cols).map((l) => truncateToWidth(l, width));
		if (this.agent.exited) {
			const note = theme.fg("dim", `— agent exited (code ${this.agent.exitCode ?? 0}) · esc/q back —`);
			return [header, ...grid.slice(0, Math.max(0, rows - 1)), note];
		}
		return [header, ...grid];
	}

	/** Detach the render subscription; the agent keeps running in the background. */
	dispose(): void {
		this.agent.setRenderCallback(null);
	}
}
