/**
 * #158 phase 5a — two-pane agents view.
 *
 * Left: the agent list (sidebar). Right: a read-only transcript of the selected
 * session (focus pane). `ctrl+w` switches which pane has focus; `!` jumps the
 * sidebar to the first agent needing attention. Below a minimum width the split is
 * unusable, so it falls back to single-pane (whichever pane is active).
 *
 * Column compositing reuses the tui `compositeColumns` helper (the same one the
 * side-panel renderer uses) so truncation and cursor-marker handling live in one
 * place. Live streaming into the focus pane is phase 5b; here the right pane is the
 * existing read-only TranscriptView, refreshed on the sidebar's poll.
 */

import { type Component, compositeColumns, type Focusable, getKeybindings } from "@zhachory1/mewrite-tui";
import type { SessionRecord } from "../../../core/daemon/index.js";
import { theme } from "../theme/theme.js";
import { AgentListComponent } from "./agent-list.js";
import { type TranscriptLine, TranscriptView } from "./transcript-view.js";

/** Terminals narrower than this render a single pane at a time. */
const MIN_TWO_PANE_WIDTH = 80;
/** Sidebar column width (the rest, minus the 1-col separator, is the focus pane). */
const SIDEBAR_WIDTH = 44;

/** Fixed, non-scrolling header row for a pane; highlights when that pane is focused. */
function paneHeader(label: string, active: boolean): string {
	return active ? theme.fg("accent", theme.bold(`▸ ${label}`)) : theme.fg("dim", `  ${label}`);
}

export interface TwoPaneCallbacks {
	/** Selecting (enter) a hosted row — hand off to the attach REPL (phase 5a). */
	onAttach: (row: SessionRecord) => void;
	onQuit: () => void;
	onNew?: () => void;
	onDelete: (row: SessionRecord) => void;
	/** Load a session's transcript for the focus pane. */
	loadTranscript: (row: SessionRecord) => Promise<TranscriptLine[]>;
	/** Viewport height in rows (for the focus pane's live-tail windowing). */
	rows: () => number;
	/** Which side the sidebar renders on. Default "left". */
	sidebarSide?: "left" | "right";
}

export class TwoPaneView implements Component, Focusable {
	focused = true;
	private active: "sidebar" | "focus" = "sidebar";
	private readonly sidebar: AgentListComponent;
	private focus: TranscriptView | null = null;
	private focusRow: SessionRecord | null = null;
	/** Guards against a stale async transcript load overwriting a newer selection. */
	private loadToken = 0;

	constructor(
		private readonly requestRender: () => void,
		private readonly cb: TwoPaneCallbacks,
	) {
		this.sidebar = new AgentListComponent(
			requestRender,
			(row) => cb.onAttach(row),
			cb.onQuit,
			cb.onNew,
			(row) => cb.onDelete(row),
			(row) => this.onSidebarSelection(row),
		);
	}

	setRows(rows: SessionRecord[]): void {
		this.sidebar.setRows(rows);
		// Keep the focus pane in sync with the (possibly changed) selection.
		const selected = this.sidebar.getSelectedRow();
		if (selected && selected.id !== this.focusRow?.id) {
			this.onSidebarSelection(selected);
		} else if (!selected) {
			this.focus = null;
			this.focusRow = null;
		} else if (this.focus) {
			void this.refreshFocus();
		}
	}

	setPollError(message: string | null): void {
		this.sidebar.setPollError(message);
	}

	invalidate(): void {}

	private onSidebarSelection(row: SessionRecord | null): void {
		this.focusRow = row;
		if (!row) {
			this.focus = null;
			this.requestRender();
			return;
		}
		const tag = row.kind === "interactive" ? "[i] " : "";
		const cwdName = row.cwd ? (row.cwd.split(/[/\\]/).pop() ?? "") : "";
		const name = row.title || cwdName || row.id.slice(0, 8);
		const title = `${tag}${name}  ${row.cwd}`;
		this.focus = new TranscriptView(title, this.requestRender, () => this.setActive("sidebar"), this.cb.rows);
		void this.refreshFocus();
	}

	private async refreshFocus(): Promise<void> {
		const row = this.focusRow;
		const view = this.focus;
		if (!row || !view) return;
		const token = ++this.loadToken;
		const lines = await this.cb.loadTranscript(row);
		if (token !== this.loadToken || this.focus !== view) return; // selection moved on
		view.setLines(lines);
	}

	private setActive(pane: "sidebar" | "focus"): void {
		// Can't focus an empty focus pane.
		if (pane === "focus" && !this.focus) return;
		this.active = pane;
		this.requestRender();
	}

	private twoPane(width: number): boolean {
		return width >= MIN_TWO_PANE_WIDTH && this.focus !== null;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "app.agents.switchPane")) {
			this.setActive(this.active === "sidebar" ? "focus" : "sidebar");
			return;
		}
		if (kb.matches(data, "app.agents.attention")) {
			const hit = this.sidebar.jumpToAttention();
			if (hit) this.setActive("sidebar");
			return;
		}
		if (this.active === "focus" && this.focus) {
			// Enter on the focused session attaches to it (interactive rows have no
			// attach handoff — they're already shown read-only here).
			if (kb.matches(data, "tui.select.confirm")) {
				if (this.focusRow) this.cb.onAttach(this.focusRow);
				return;
			}
			this.focus.handleInput(data);
		} else {
			this.sidebar.handleInput(data);
		}
	}

	render(width: number): string[] {
		if (!this.twoPane(width)) {
			// Single-pane fallback: show whichever pane is active, with its header.
			const viewport = this.cb.rows();
			if (this.active === "focus" && this.focus) {
				return [
					paneHeader("Focus  (ctrl+w)", true),
					...this.focus.render(width).slice(0, Math.max(0, viewport - 1)),
				];
			}
			return [
				paneHeader("Your agents  (ctrl+w)", true),
				...this.sidebar.render(width).slice(0, Math.max(0, viewport - 1)),
			];
		}
		const sidebarW = SIDEBAR_WIDTH;
		const focusW = Math.max(1, width - sidebarW - 1); // 1 for the separator
		// Cap the whole view to the viewport so the FIXED header row (below) never
		// scrolls off the top when the focus transcript is tall.
		const viewport = this.cb.rows();
		// A FIXED header row per column names the pane and highlights the active one.
		const sidebarBody = this.sidebar.render(sidebarW).slice(0, Math.max(0, viewport - 1));
		const focusBody = (this.focus ? this.focus.render(focusW) : [theme.fg("dim", " no session selected")]).slice(
			0,
			Math.max(0, viewport - 1),
		);
		const sidebarCol = [paneHeader("Your agents", this.active === "sidebar"), ...sidebarBody];
		const focusCol = [paneHeader("Focus  (ctrl+w)", this.active === "focus"), ...focusBody];
		const sidebarOnLeft = (this.cb.sidebarSide ?? "left") === "left";
		const left = sidebarOnLeft ? sidebarCol : focusCol;
		const right = sidebarOnLeft ? focusCol : sidebarCol;
		const leftW = sidebarOnLeft ? sidebarW : focusW;
		const rightW = sidebarOnLeft ? focusW : sidebarW;
		const rows = Math.min(viewport, Math.max(left.length, right.length));
		return compositeColumns(left, right, leftW, rightW, rows);
	}
}
