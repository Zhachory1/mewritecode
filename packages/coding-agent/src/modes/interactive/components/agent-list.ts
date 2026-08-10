/**
 * #152 — Agent view list component.
 *
 * Read-only, scrollable list of sessions ("agents"). Selecting a row and pressing
 * the confirm key hands the selected row back to agents.ts, which routes by kind
 * (hosted → attach REPL, interactive → read-only transcript view).
 */

import { basename } from "node:path";
import { type Component, type Focusable, getKeybindings, truncateToWidth, visibleWidth } from "@zhachory1/mewrite-tui";
import type { SessionRecord, SessionState } from "../../../core/daemon/index.js";
import { theme } from "../theme/theme.js";

const STATE_GLYPH: Record<SessionState, string> = {
	running: "●",
	idle: "○",
	stopped: "·",
	error: "✗",
};

/**
 * Status buckets for the grouped list (agents view v2, #185). v1 ships three:
 * working / errored / completed. `waiting for input` is deferred until the
 * steer/pause channel lands (see #185 Phase C+). Order = attention-first:
 * working (live), then errored (needs you), then completed.
 */
type Bucket = "working" | "errored" | "completed";
const BUCKET_ORDER: readonly Bucket[] = ["working", "errored", "completed"];
const BUCKET_LABEL: Record<Bucket, string> = {
	working: "WORKING",
	errored: "ERRORED",
	completed: "COMPLETED",
};

function bucketOf(state: SessionState): Bucket {
	if (state === "running") return "working";
	if (state === "error") return "errored";
	return "completed"; // idle / stopped
}

/**
 * Idle hosted sessions not updated within this window are hidden by default (they
 * are usually finished/abandoned). Running/error/interactive rows always show, as
 * do recently-active idle ones. Press `a` to reveal everything.
 */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function isActive(s: SessionRecord, now: number): boolean {
	if (s.state === "running" || s.state === "error") return true;
	if (s.kind === "interactive") return true; // a live liveness file means it's live
	const updated = new Date(s.updatedAt).getTime();
	if (Number.isNaN(updated)) return true; // don't hide rows with unparseable timestamps
	return now - updated < RECENT_WINDOW_MS;
}

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const diffMs = Date.now() - then;
	const mins = Math.floor(diffMs / 60000);
	const hours = Math.floor(diffMs / 3600000);
	const days = Math.floor(diffMs / 86400000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;
	return `${Math.floor(days / 7)}w`;
}

export class AgentListComponent implements Component, Focusable {
	focused = true;
	private rows: SessionRecord[] = [];
	private selectedId: string | null = null;
	private pollError: string | null = null;
	private showAll = false;
	/** Session ids the focus pane has flagged as needing attention (e.g. pending
	 * approval). Errored sessions are always attention regardless of this set. */
	private attentionIds = new Set<string>();

	setAttention(ids: Iterable<string>): void {
		this.attentionIds = new Set(ids);
		this.requestRender();
	}

	/** True when a row should be flagged for attention: errored, or explicitly marked. */
	needsAttention(s: SessionRecord): boolean {
		return s.state === "error" || this.attentionIds.has(s.id);
	}

	/** Select the first visible attention row; returns it (or null if none). */
	jumpToAttention(): SessionRecord | null {
		return this.selectAttention((r) => this.needsAttention(r));
	}

	/**
	 * Rows currently visible given the active/show-all filter, ordered by status
	 * bucket (working, errored, completed) then recency. Selection and keyboard nav
	 * operate on this flat ordered list; the group headers in render() are purely
	 * visual and are not selectable.
	 */
	private visibleRows(): SessionRecord[] {
		const now = Date.now();
		const filtered = this.showAll ? this.rows : this.rows.filter((r) => isActive(r, now));
		return [...filtered].sort((a, b) => {
			const ba = BUCKET_ORDER.indexOf(bucketOf(a.state));
			const bb = BUCKET_ORDER.indexOf(bucketOf(b.state));
			if (ba !== bb) return ba - bb;
			return b.updatedAt.localeCompare(a.updatedAt);
		});
	}

	constructor(
		private readonly requestRender: () => void,
		private readonly onSelect: (row: SessionRecord) => void,
		private readonly onQuit: () => void,
		private readonly onNew: () => void = () => {},
		private readonly onDelete: (row: SessionRecord) => void = () => {},
		private readonly onSelectionChange: (row: SessionRecord | null) => void = () => {},
	) {}

	/** The currently highlighted row, or null when the visible list is empty. */
	getSelectedRow(): SessionRecord | null {
		return this.visibleRows().find((r) => r.id === this.selectedId) ?? null;
	}

	private selectAttention(needsAttention: (row: SessionRecord) => boolean): SessionRecord | null {
		const target = this.visibleRows().find(needsAttention);
		if (target) {
			this.selectedId = target.id;
			this.onSelectionChange(target);
			this.requestRender();
		}
		return target ?? null;
	}

	setRows(rows: SessionRecord[]): void {
		this.rows = rows;
		const visible = this.visibleRows();
		const prevId = this.selectedId;
		if (visible.length === 0) {
			this.selectedId = null;
		} else if (!this.selectedId || !visible.some((r) => r.id === this.selectedId)) {
			this.selectedId = visible[0].id;
		}
		if (this.selectedId !== prevId) this.emitSelection();
		this.pollError = null;
		this.requestRender();
	}

	setPollError(message: string | null): void {
		this.pollError = message;
		this.requestRender();
	}

	invalidate(): void {}

	private selectedIndex(): number {
		if (!this.selectedId) return -1;
		return this.visibleRows().findIndex((r) => r.id === this.selectedId);
	}

	private emitSelection(): void {
		this.onSelectionChange(this.getSelectedRow());
	}

	private move(delta: number): void {
		const visible = this.visibleRows();
		if (visible.length === 0) return;
		const cur = Math.max(0, this.selectedIndex());
		// Single-step up/down wraps around (top→bottom, bottom→top) so you can jump to
		// the far end in one press. Page up/down still clamps — a 10-row jump shouldn't
		// teleport across both ends.
		const next =
			Math.abs(delta) === 1
				? (cur + delta + visible.length) % visible.length
				: Math.min(visible.length - 1, Math.max(0, cur + delta));
		if (visible[next].id !== this.selectedId) {
			this.selectedId = visible[next].id;
			this.emitSelection();
		}
		this.requestRender();
	}

	private toggleShowAll(): void {
		this.showAll = !this.showAll;
		const visible = this.visibleRows();
		if (!visible.some((r) => r.id === this.selectedId)) {
			this.selectedId = visible[0]?.id ?? null;
			this.emitSelection();
		}
		this.requestRender();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.move(-1);
		} else if (kb.matches(data, "tui.select.down")) {
			this.move(1);
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.move(-10);
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.move(10);
		} else if (kb.matches(data, "tui.select.confirm")) {
			const row = this.visibleRows().find((r) => r.id === this.selectedId);
			if (row) this.onSelect(row);
		} else if (kb.matches(data, "app.agents.new")) {
			this.onNew();
		} else if (kb.matches(data, "app.agents.delete")) {
			const row = this.visibleRows().find((r) => r.id === this.selectedId);
			// Only daemon-hosted sessions are stored and deletable; interactive live
			// sessions have no delete endpoint.
			if (row && row.kind !== "interactive") this.onDelete(row);
		} else if (kb.matches(data, "app.agents.toggleAll")) {
			this.toggleShowAll();
		} else if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "app.agents.back")) {
			this.onQuit();
		}
	}

	render(width: number): string[] {
		// No own title line — the enclosing TwoPaneView renders the "Your agents" pane
		// header. Only the "(all)" filter state is worth surfacing here.
		const lines: string[] = [];
		const visible = this.visibleRows();
		const hidden = this.rows.length - visible.length;
		if (this.showAll) lines.push(theme.fg("dim", truncateToWidth("(showing all)", width)));
		if (visible.length === 0) {
			const hint = hidden > 0 ? "n new agent · a show all · q/esc quit" : "n new agent · q/esc quit";
			lines.push("");
			lines.push(
				theme.fg(
					"dim",
					truncateToWidth(hidden > 0 ? `No active agents (${hidden} hidden).` : "No agents yet.", width),
				),
			);
			lines.push("");
			lines.push(theme.fg("dim", truncateToWidth(hint, width)));
			return lines;
		}
		let lastBucket: Bucket | null = null;
		for (const s of visible) {
			const bucket = bucketOf(s.state);
			if (bucket !== lastBucket) {
				const count = visible.filter((r) => bucketOf(r.state) === bucket).length;
				if (lastBucket !== null) lines.push("");
				lines.push(theme.fg("dim", truncateToWidth(`${BUCKET_LABEL[bucket]} (${count})`, width)));
				lastBucket = bucket;
			}
			const selected = s.id === this.selectedId;
			const glyph = STATE_GLYPH[s.state] ?? "?";
			// Interactive (terminal) sessions get an [i] marker; daemon-hosted agents are
			// the default and unmarked.
			const tag = s.kind === "interactive" ? "[i] " : "";
			const attn = this.needsAttention(s) ? theme.fg("warning", "! ") : "  ";
			// Prefer a real title, then the working-directory name, then a short id.
			const name = s.title ?? ((s.cwd ? basename(s.cwd) : "") || s.id.slice(0, 8));
			const updated = relativeTime(s.updatedAt);
			const prefix = selected ? "› " : "  ";
			const head = `${prefix}${attn}${glyph} ${tag}${name}`;
			// Right-align the relative time when there's room.
			const gap = Math.max(1, width - visibleWidth(head) - updated.length);
			const row = truncateToWidth(`${head}${" ".repeat(gap)}${theme.fg("dim", updated)}`, width);
			lines.push(selected ? theme.fg("accent", row) : row);
		}
		lines.push("");
		if (this.pollError)
			lines.push(theme.fg("warning", truncateToWidth(`daemon unreachable: ${this.pollError}`, width)));
		const allHint = this.showAll ? "a active-only" : hidden > 0 ? `a show all (+${hidden})` : "a show all";
		// Split across two lines so the hint isn't truncated in the narrow sidebar.
		lines.push(theme.fg("dim", truncateToWidth(`↑/↓ select · enter attach · n new`, width)));
		lines.push(theme.fg("dim", truncateToWidth(`d delete · ${allHint} · q/esc quit`, width)));
		return lines;
	}
}
