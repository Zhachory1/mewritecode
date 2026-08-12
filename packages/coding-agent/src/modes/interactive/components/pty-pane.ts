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
 * event-type (press/repeat/release) variants so no esc encoding slips through to
 * the agent (where esc = abort). Deliberately does NOT match other CSI-u keys.
 */
const KITTY_ESCAPE = /^\x1b\[27(?:;\d+)?(?::\d+)?u$/;

/**
 * True for a lone Escape keypress: raw ESC, or any kitty-protocol esc form. NOT
 * true for ESC-prefixed sequences (arrows/alt/CSI), which must reach the agent.
 * A bare ESC is exactly one byte; anything longer that starts with ESC[ but isn't
 * a kitty esc (e.g. an arrow `\x1b[A`) is forwarded.
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
		// esc (and ctrl+w, handled one level up in TwoPaneView) always leaves the pane
		// so there is a reliable exit hatch. Trade-off: the embedded agent never sees a
		// bare esc. Acceptable for the "jump in, type a message, enter" flow; exit
		// reliability wins. ctrl+c is NOT intercepted here — it's forwarded so you can
		// interrupt a running agent. Everything else (text, enter, arrows, ...) too.
		if (isBareEscape(data)) {
			this.onBack();
			return;
		}
		if (this.agent.exited) return;
		this.agent.write(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const rows = this.gridRows();
		this.agent.resize(width, rows);
		const hint = theme.fg("dim", "  (esc to leave)");
		const header = truncateToWidth(theme.bold(this.title) + hint, width);
		const grid = renderBuffer(this.agent.buffer, rows, this.agent.cols);
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
