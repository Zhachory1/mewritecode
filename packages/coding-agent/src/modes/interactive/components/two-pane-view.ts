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

import { type Component, type Focusable, getKeybindings } from "@zhachory1/mewrite-tui";
import type { AttachedSession, CaveClient, SessionRecord } from "../../../core/daemon/index.js";
import { theme } from "../theme/theme.js";
import { AgentListComponent } from "./agent-list.js";
import type { LivePtyAgent } from "./pty-agent.js";
import { PtyPane } from "./pty-pane.js";
import { StreamingSessionView } from "./streaming-session-view.js";
import { type TranscriptLine, TranscriptView } from "./transcript-view.js";

/** Fixed, non-scrolling header row for a pane; highlights when that pane is focused. */
function paneHeader(label: string, active: boolean): string {
	return active ? theme.fg("accent", theme.bold(`▸ ${label}`)) : theme.fg("dim", `  ${label}`);
}

export interface TwoPaneCallbacks {
	onQuit: () => void;
	onNew?: () => void;
	onDelete: (row: SessionRecord) => void;
	/**
	 * Resume an interactive `[i]` row as a real interactive session (replace-and-
	 * return). When set, selecting an interactive row calls this instead of opening
	 * the read-only transcript pane. Hosted rows still open the live focus pane.
	 */
	onResume?: (row: SessionRecord) => void;
	/** Steer (redirect) a running monitored agent: prompt for text and deliver it. */
	onSteer?: (row: SessionRecord) => void;
	/** Interrupt (stop) a running monitored agent. */
	onInterrupt?: (row: SessionRecord) => void;
	/**
	 * Return the live pty agent this viewer owns for a row (matched by pid), or
	 * undefined for rows we don't own (foreign/daemon). When present, the row opens
	 * an interactive `PtyPane` instead of the read-only transcript.
	 */
	getLivePtyAgent?: (row: SessionRecord) => LivePtyAgent | undefined;
	/** Load a session's transcript for the read-only focus pane (interactive rows). */
	loadTranscript: (row: SessionRecord) => Promise<TranscriptLine[]>;
	/** Open a live WS attach for a hosted session (drives the live focus pane). */
	attach: (id: string) => AttachedSession;
	/** Client for seeding the live focus pane's history. */
	client: Pick<CaveClient, "getTranscript">;
	/** Viewport height in rows (for the focus pane's windowing). */
	rows: () => number;
	/** Retained for compatibility; the side-by-side split is retired (#185), so unused. */
	sidebarSide?: "left" | "right";
}

export class TwoPaneView implements Component, Focusable {
	focused = true;
	private active: "sidebar" | "focus" = "sidebar";
	private readonly sidebar: AgentListComponent;
	/** Live pty (owned), live hosted (WS), or read-only (interactive) focus pane. */
	private focus: StreamingSessionView | TranscriptView | PtyPane | null = null;
	private focusRow: SessionRecord | null = null;
	/** Guards against a stale async transcript load overwriting a newer selection. */
	private loadToken = 0;

	constructor(
		private readonly requestRender: () => void,
		private readonly cb: TwoPaneCallbacks,
	) {
		this.sidebar = new AgentListComponent(
			requestRender,
			// Enter on a row:
			//  - interactive + running -> open the read-only live monitor (tail its JSONL);
			//    another process owns the live turn, so we can't drive it in place.
			//  - interactive + not running -> resume it as a real session (replace-and-return).
			//  - hosted -> focus the live WS pane.
			(row) => {
				if (row.kind === "interactive" && row.state !== "running" && cb.onResume) cb.onResume(row);
				else this.setActive("focus");
			},
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

	/** Close any live focus-pane WebSocket / detach pty render. Call when leaving the view. */
	dispose(): void {
		if (this.focus instanceof StreamingSessionView || this.focus instanceof PtyPane) this.focus.dispose();
	}

	invalidate(): void {}

	/**
	 * True when an interactive pty pane is focused. The agents view hides its logo
	 * header in this state so the embedded interactive UI gets the full height.
	 */
	isPtyPaneActive(): boolean {
		return this.active === "focus" && this.focus instanceof PtyPane;
	}

	private onSidebarSelection(row: SessionRecord | null): void {
		// Tear down any live session before switching (closes its WS / detaches pty render).
		if (this.focus instanceof StreamingSessionView || this.focus instanceof PtyPane) this.focus.dispose();
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
		// A running agent is monitored read-only (another process owns its live turn);
		// call it out so the pane isn't mistaken for an interactive session.
		const monitorHint = row.kind === "interactive" && row.state === "running" ? "  — live monitor (read-only)" : "";
		const title = `${tag}${name}  ${row.cwd}${monitorHint}`;
		// If this viewer owns a live pty for the row, drive it interactively in place.
		const liveAgent = this.cb.getLivePtyAgent?.(row);
		if (liveAgent) {
			const ptyTitle = `${tag}${name}  ${row.cwd}`;
			this.focus = new PtyPane(
				ptyTitle,
				liveAgent,
				this.requestRender,
				() => this.setActive("sidebar"),
				this.cb.rows,
			);
			this.requestRender();
			return;
		}
		if (row.kind === "interactive") {
			// Terminal sessions can't be driven remotely; show them read-only. A running
			// agent additionally gets steer/interrupt controls (the runaway-catcher).
			const controls =
				row.state === "running" && this.cb.onSteer && this.cb.onInterrupt
					? { onSteer: () => this.cb.onSteer?.(row), onInterrupt: () => this.cb.onInterrupt?.(row) }
					: undefined;
			const view = new TranscriptView(
				title,
				this.requestRender,
				() => this.setActive("sidebar"),
				this.cb.rows,
				controls,
			);
			this.focus = view;
			void this.refreshFocus();
		} else {
			this.focus = new StreamingSessionView(row.id, title, {
				attach: this.cb.attach,
				client: this.cb.client,
				requestRender: this.requestRender,
				onBack: () => this.setActive("sidebar"),
				rows: this.cb.rows,
				model: row.model,
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
		// Agents view v2 (#185): no side-by-side. Full-screen single pane — the list,
		// or the focus view once a row is selected. list → focus → back.
		const viewport = this.cb.rows();
		if (this.active === "focus" && this.focus) {
			return [paneHeader("Focus  (ctrl+w)", true), ...this.focus.render(width).slice(0, Math.max(0, viewport - 1))];
		}
		return [
			paneHeader("Your agents  (ctrl+w)", true),
			...this.sidebar.render(width).slice(0, Math.max(0, viewport - 1)),
		];
	}
}
