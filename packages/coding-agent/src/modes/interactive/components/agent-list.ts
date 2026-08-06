/**
 * #152 — Agent view list component.
 *
 * Read-only, scrollable list of sessions ("agents"). Selecting a row and pressing
 * the confirm key hands the selected row back to agents.ts, which routes by kind
 * (hosted → attach REPL, interactive → read-only transcript view).
 */

import { basename } from "node:path";
import { type Component, type Focusable, getKeybindings, truncateToWidth } from "@zhachory1/mewrite-tui";
import type { SessionRecord, SessionState } from "../../../core/daemon/index.js";
import { theme } from "../theme/theme.js";

const STATE_GLYPH: Record<SessionState, string> = {
	running: "●",
	idle: "○",
	stopped: "·",
	error: "✗",
};

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

	constructor(
		private readonly requestRender: () => void,
		private readonly onSelect: (row: SessionRecord) => void,
		private readonly onQuit: () => void,
	) {}

	setRows(rows: SessionRecord[]): void {
		this.rows = rows;
		if (rows.length === 0) {
			this.selectedId = null;
		} else if (!this.selectedId || !rows.some((r) => r.id === this.selectedId)) {
			this.selectedId = rows[0].id;
		}
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
		return this.rows.findIndex((r) => r.id === this.selectedId);
	}

	private move(delta: number): void {
		if (this.rows.length === 0) return;
		const cur = Math.max(0, this.selectedIndex());
		const next = Math.min(this.rows.length - 1, Math.max(0, cur + delta));
		this.selectedId = this.rows[next].id;
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
			const row = this.rows.find((r) => r.id === this.selectedId);
			if (row) this.onSelect(row);
		} else if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "app.agents.back")) {
			this.onQuit();
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.bold("Agents"));
		if (this.rows.length === 0) {
			lines.push("");
			lines.push(theme.fg("dim", "No agents. Start one with `mewrite` or `mewrite serve`."));
			lines.push("");
			lines.push(theme.fg("dim", "q/esc to quit"));
			return lines;
		}
		for (const s of this.rows) {
			const selected = s.id === this.selectedId;
			const glyph = STATE_GLYPH[s.state] ?? "?";
			const tag = s.kind === "interactive" ? "[i]" : s.kind === "hosted" ? "[d]" : "   ";
			const label = s.title ?? s.id.slice(0, 8);
			const cwd = s.cwd ? basename(s.cwd) : "";
			const updated = relativeTime(s.updatedAt);
			const cols = `${tag} ${glyph} ${label}`;
			const meta = theme.fg("dim", `${s.state.padEnd(8)} ${cwd} ${updated}`);
			const prefix = selected ? "› " : "  ";
			const row = truncateToWidth(`${prefix}${cols}  ${meta}`, width);
			lines.push(selected ? theme.fg("accent", row) : row);
		}
		lines.push("");
		if (this.pollError) lines.push(theme.fg("warning", `daemon unreachable: ${this.pollError}`));
		lines.push(theme.fg("dim", "↑/↓ select · enter attach · q/esc quit"));
		return lines;
	}
}
