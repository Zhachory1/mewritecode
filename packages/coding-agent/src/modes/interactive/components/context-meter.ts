import { type Component, truncateToWidth, visibleWidth } from "@zhachory1/mewrite-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";

const BAR_FILLED = "█";
const BAR_EMPTY = "░";
const SIDE_PADDING = 1;
const MIN_BAR_CELLS = 8;
const MAX_BAR_CELLS = 16;

export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

function severity(pct: number): "dim" | "success" | "warning" | "error" {
	if (pct >= 95) return "error";
	if (pct >= 80) return "warning";
	if (pct >= 50) return "success";
	return "dim";
}

/**
 * Render a styled context bar of the form `███░░░ 20% 204k` for a given number of
 * bar cells. Pure: takes raw usage values (no AgentSession), so both the local
 * interactive meter and the remote agents focus pane can share one renderer.
 * `percent === null` (unknown, e.g. post-compaction) renders an empty bar with `?`.
 */
export function renderContextBar(usage: { tokens: number | null; percent: number | null }, cells: number): string {
	const pctValue = usage.percent ?? 0;
	const tokens = usage.tokens ?? 0;
	const colorKey = severity(pctValue);
	const barCells = Math.max(1, cells);
	const filledCells = Math.min(barCells, Math.max(0, Math.round((pctValue / 100) * barCells)));
	const bar = BAR_FILLED.repeat(filledCells);
	const empty = BAR_EMPTY.repeat(Math.max(0, barCells - filledCells));
	const pctText = usage.percent !== null ? `${pctValue.toFixed(0)}%` : "?";
	const suffix = ` ${pctText} ${formatTokens(tokens)}`;
	const styledBar = theme.fg(colorKey, bar);
	const styledEmpty = theme.fg("dim", empty);
	const styledSuffix = theme.fg(colorKey === "dim" ? "dim" : colorKey, suffix);
	return `${styledBar}${styledEmpty}${styledSuffix}`;
}

/**
 * Single-line context meter rendered just under the editor.
 *
 * Reads context usage fresh from the session on each render — there is no
 * cached state, so callers do not need to invalidate it. The TUI already
 * triggers redraws when session state changes (same path the footer uses).
 */
export class ContextMeterComponent implements Component {
	constructor(private session: AgentSession) {}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	invalidate(): void {
		// No cached state — renders fresh from session each frame.
	}

	render(width: number): string[] {
		if (width < MIN_BAR_CELLS + SIDE_PADDING * 2) return [];

		const usage = this.session.getContextUsage();
		const contextWindow = usage?.contextWindow ?? this.session.state.model?.contextWindow ?? 0;
		if (contextWindow <= 0) return [];

		const pctText = usage?.percent !== null && usage?.percent !== undefined ? `${usage.percent.toFixed(0)}%` : "?";
		const suffixWidth = visibleWidth(` ${pctText} ${formatTokens(usage?.tokens ?? 0)}`);
		const available = width - SIDE_PADDING * 2 - suffixWidth;
		const barCells = Math.min(MAX_BAR_CELLS, Math.max(MIN_BAR_CELLS, available));
		const padding = " ".repeat(SIDE_PADDING);
		const line = `${padding}${renderContextBar({ tokens: usage?.tokens ?? null, percent: usage?.percent ?? null }, barCells)}`;
		return [truncateToWidth(line, width, "")];
	}
}
