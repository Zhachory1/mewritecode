/**
 * Live PTY pane for the agents view.
 *
 * A thin focus-pane view over a `LivePtyAgent` (which owns the pty + emulator so
 * output keeps accumulating while this pane is closed). Keystrokes are forwarded
 * straight to the child's interactive UI — no steer modal, no read-only tail.
 */

import type { IMarker } from "@xterm/headless";
import { type Component, type Focusable, getKeybindings, truncateToWidth } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import type { LivePtyAgent } from "./pty-agent.js";
import { renderBufferAt } from "./pty-render.js";

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

	/**
	 * Marker on the viewport-top row while scrolled into history, or null when
	 * following the live tail. A marker (not a raw row number) keeps the viewport
	 * pinned to the same line as the child emits output AND as xterm trims old
	 * scrollback: `marker.line` tracks the row through eviction and reports -1 once
	 * the pinned line itself is evicted, at which point we snap to the tail.
	 */
	private anchor: IMarker | null = null;
	/** null until the first render; a later change means a resize/reflow. */
	private lastWidth: number | null = null;
	private lastRows: number | null = null;

	constructor(
		private readonly title: string,
		private readonly agent: LivePtyAgent,
		private readonly requestRender: () => void,
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

	private anchorTop(): number {
		const line = this.anchor?.line ?? -1;
		return line < 0 ? this.agent.buffer.baseY : line;
	}

	private clearAnchor(): void {
		this.anchor?.dispose();
		this.anchor = null;
	}

	/** Move the history viewport by `delta` rows; clamp to [0, baseY]; tail clears the anchor. */
	private scrollByRows(delta: number): void {
		const baseY = this.agent.buffer.baseY;
		const next = this.anchorTop() + delta;
		this.clearAnchor();
		if (next < baseY) this.anchor = this.agent.markRow(Math.max(0, next));
		this.requestRender();
	}

	handleInput(data: string): void {
		// Scrollback nav works whether the agent runs or has exited, so history is
		// reachable in both states. These are shift+pageUp/Down/End by default —
		// distinct from the bare pageUp/pageDown the child owns, so nothing the
		// forwarded child needs is stolen.
		const kb = getKeybindings();
		if (kb.matches(data, "app.agents.scrollToTail")) {
			if (this.anchor !== null) {
				this.clearAnchor();
				this.requestRender();
			}
			return;
		}
		if (kb.matches(data, "app.agents.scrollUp")) {
			this.scrollByRows(-Math.max(1, this.gridRows() - 1));
			return;
		}
		if (kb.matches(data, "app.agents.scrollDown")) {
			this.scrollByRows(Math.max(1, this.gridRows() - 1));
			return;
		}
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
		// A resize (terminal or pane) reflows the xterm buffer, so the pinned line no
		// longer maps cleanly to a viewport top. Snap back to the live tail. The
		// first render (last* still null) is not a resize.
		if (this.anchor !== null && this.lastWidth !== null && (width !== this.lastWidth || rows !== this.lastRows)) {
			this.clearAnchor();
		}
		this.lastWidth = width;
		this.lastRows = rows;
		this.agent.resize(width, rows);

		const baseY = this.agent.buffer.baseY;
		let top = baseY;
		if (this.anchor !== null) {
			const line = this.anchor.line;
			// Reached the tail, or the pinned line was evicted (line < 0) → follow tail.
			if (line < 0 || line >= baseY) this.clearAnchor();
			else top = line;
		}
		const paused = this.anchor !== null;

		// Lines strictly below the current viewport = genuinely unseen output.
		const below = Math.max(0, baseY - top - rows);
		const hint = paused
			? theme.fg("dim", `  (↓ ${below} more · shift+end tail)`)
			: theme.fg("dim", "  (ctrl+w to leave · esc stops the agent · shift+pgup scroll)");
		const header = truncateToWidth(theme.bold(this.title) + hint, width);
		// The embedded emulator (@xterm/headless, Unicode v6) and the TUI's
		// visibleWidth() (RGI emoji) disagree on some glyph widths (e.g. ✅ is 1 vs 2),
		// so a grid line that fills the child's columns can measure wider than `width`
		// to the outer renderer. Clamp each line so doRender's width invariant holds.
		const grid = renderBufferAt(this.agent.buffer, top, rows, this.agent.cols).map((l) => truncateToWidth(l, width));
		if (this.agent.exited) {
			const note = theme.fg("dim", `— agent exited (code ${this.agent.exitCode ?? 0}) · esc/q back —`);
			return [header, ...grid.slice(0, Math.max(0, rows - 1)), note];
		}
		return [header, ...grid];
	}

	/** Detach the render subscription; the agent keeps running in the background. */
	dispose(): void {
		this.clearAnchor();
		this.agent.setRenderCallback(null);
	}
}
