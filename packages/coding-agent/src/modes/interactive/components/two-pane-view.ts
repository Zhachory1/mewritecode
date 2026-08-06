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
 * place. Hosted sessions render live and interactive in the focus pane (phase 5b,
 * StreamingSessionView); interactive `[i]` terminal sessions stay read-only.
 */

import { type Component, compositeColumns, type Focusable, getKeybindings } from "@zhachory1/mewrite-tui";
import type { AttachedSession, CaveClient, SessionRecord } from "../../../core/daemon/index.js";
import { theme } from "../theme/theme.js";
import { AgentListComponent } from "./agent-list.js";
import { StreamingSessionView } from "./streaming-session-view.js";
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
	onQuit: () => void;
	onNew?: () => void;
	onDelete: (row: SessionRecord) => void;
	/** Load a session's transcript for the read-only focus pane (interactive rows). */
	loadTranscript: (row: SessionRecord) => Promise<TranscriptLine[]>;
	/** Open a live WS attach for a hosted session (drives the live focus pane). */
	attach: (id: string) => AttachedSession;
	/** Client for seeding the live focus pane's history. */
	client: Pick<CaveClient, "getTranscript">;
	/** Viewport height in rows (for the focus pane's windowing). */
	rows: () => number;
	/** Which side the sidebar renders on. Default "left". */
	sidebarSide?: "left" | "right";
}

export class TwoPaneView implements Component, Focusable {
	focused = true;
	private active: "sidebar" | "focus" = "sidebar";
	private readonly sidebar: AgentListComponent;
	/** Live (hosted) or read-only (interactive) focus pane. */
	private focus: StreamingSessionView | TranscriptView | null = null;
	private focusRow: SessionRecord | null = null;
	/** Guards against a stale async transcript load overwriting a newer selection. */
	private loadToken = 0;

	constructor(
		private readonly requestRender: () => void,
		private readonly cb: TwoPaneCallbacks,
	) {
		this.sidebar = new AgentListComponent(
			requestRender,
			// Enter on a row focuses the pane (hosted rows are interactive there).
			() => this.setActive("focus"),
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
			if (this.focus instanceof StreamingSessionView) this.focus.dispose();
			this.focus = null;
			this.focusRow = null;
		} else if (this.focus instanceof TranscriptView) {
			// Read-only pane polls; the live pane updates itself over its WS.
			void this.refreshFocus();
		}
	}

	setPollError(message: string | null): void {
		this.sidebar.setPollError(message);
	}

	/** Close any live focus-pane WebSocket. Call when leaving the view. */
	dispose(): void {
		if (this.focus instanceof StreamingSessionView) this.focus.dispose();
	}

	invalidate(): void {}

	private onSidebarSelection(row: SessionRecord | null): void {
		// Tear down any live session before switching (closes its WS).
		if (this.focus instanceof StreamingSessionView) this.focus.dispose();
		this.focusRow = row;
		this.loadToken++;
		if (!row) {
			this.focus = null;
			this.requestRender();
			return;
		}
		const tag = row.kind === "interactive" ? "[i] " : "";
		const cwdName = row.cwd ? (row.cwd.split(/[/\\]/).pop() ?? "") : "";
		const name = row.title || cwdName || row.id.slice(0, 8);
		const title = `${tag}${name}  ${row.cwd}`;
		if (row.kind === "interactive") {
			// Terminal sessions can't be driven remotely; show them read-only.
			const view = new TranscriptView(title, this.requestRender, () => this.setActive("sidebar"), this.cb.rows);
			this.focus = view;
			void this.refreshFocus();
		} else {
			this.focus = new StreamingSessionView(row.id, title, {
				attach: this.cb.attach,
				client: this.cb.client,
				requestRender: this.requestRender,
				onBack: () => this.setActive("sidebar"),
				rows: this.cb.rows,
			});
		}
		this.requestRender();
	}

	private async refreshFocus(): Promise<void> {
		const row = this.focusRow;
		const view = this.focus;
		if (!row || !(view instanceof TranscriptView)) return;
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
