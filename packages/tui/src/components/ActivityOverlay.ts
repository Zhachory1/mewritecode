/**
 * Activity monitor overlay (F2).
 *
 * Renders a flat, live list of the session's running/queued/finished
 * activities — model calls, tools, foreground subagents — with elapsed time
 * and stalled detection. The blocking leaf (the row that is actually holding
 * up the reply) is marked so the user can see *why* a turn is slow.
 *
 * This package is LOW-level and must not import from `coding-agent`. The
 * overlay therefore defines its OWN structural snapshot + registry interfaces.
 * The real `ActivityRegistry` (in coding-agent) returns objects that are
 * structurally compatible with {@link ActivitySnapshot}; interactive-mode
 * adapts them. Render is flat in v1 (the `depth` field is ignored).
 */
import { formatElapsed } from "../format-elapsed.js";
import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

export { formatElapsed };

export type ActivityKind = "model" | "tool" | "subagent" | "process" | "mcp";
export type ActivityStatus = "running" | "queued" | "done" | "error";

/**
 * Structural snapshot of a single activity. Mirrors the shape returned by the
 * coding-agent `ActivityRegistry.list()` so the two never share a type import.
 */
export interface ActivitySnapshot {
	id: string;
	kind: ActivityKind;
	label: string;
	detail?: string;
	status: ActivityStatus;
	startedAt: number;
	/** now - startedAt (or endedAt - startedAt once finished). */
	elapsedMs: number;
	/** now - lastProgressAt; 0 when never progress-tracked or just progressed. */
	stalledMs: number;
	/** Nesting depth. Always 0 in v1 (flat render). */
	depth: number;
}

/** Structural registry interface the overlay reads from. */
export interface ActivityOverlayRegistry {
	/** Current snapshot of every tracked activity, pre-sorted by the registry. */
	list(): ActivitySnapshot[];
	/** Subscribe to changes. Returns an unsubscribe function. */
	subscribe(listener: () => void): () => void;
}

/** Empty registry used before the session wires a real one. */
export const NULL_ACTIVITY_REGISTRY: ActivityOverlayRegistry = {
	list: () => [],
	subscribe: () => () => {},
};

export interface ActivityOverlayTheme {
	border: (text: string) => string;
	header: (text: string) => string;
	row: (text: string) => string;
	muted: (text: string) => string;
	accent: (text: string) => string;
	error: (text: string) => string;
}

const IDENTITY: ActivityOverlayTheme = {
	border: (s) => s,
	header: (s) => s,
	row: (s) => s,
	muted: (s) => s,
	accent: (s) => s,
	error: (s) => s,
};

export interface ActivityOverlayOptions {
	registry?: ActivityOverlayRegistry;
	theme?: ActivityOverlayTheme;
	maxRows?: number;
	/** Stalled rows past this many ms render the `· stalled Ns` marker. */
	stallThresholdMs?: number;
}

const EMPTY_STATE = "No activity — session idle.";
const DEFAULT_STALL_THRESHOLD_MS = 10_000;
const BLOCKER_MARK = "▸";

export class ActivityOverlay implements Component {
	private registry: ActivityOverlayRegistry;
	private theme: ActivityOverlayTheme;
	private maxRows: number;
	private stallThresholdMs: number;
	private unsubscribe?: () => void;
	private redraw?: () => void;

	constructor(options: ActivityOverlayOptions = {}) {
		this.registry = options.registry ?? NULL_ACTIVITY_REGISTRY;
		this.theme = options.theme ?? IDENTITY;
		this.maxRows = options.maxRows ?? 12;
		this.stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
	}

	/** Wire a new registry (e.g. when the session registers the real one). */
	setRegistry(registry: ActivityOverlayRegistry): void {
		if (this.unsubscribe) this.unsubscribe();
		this.registry = registry;
		this.unsubscribe = registry.subscribe(() => this.redraw?.());
	}

	/** Bind a redraw callback so registry events trigger a TUI re-render. */
	bindRedraw(redraw: () => void): void {
		this.redraw = redraw;
		if (!this.unsubscribe) {
			this.unsubscribe = this.registry.subscribe(() => this.redraw?.());
		}
	}

	dispose(): void {
		if (this.unsubscribe) this.unsubscribe();
		this.unsubscribe = undefined;
		this.redraw = undefined;
	}

	invalidate(): void {
		// Stateless render — nothing to clear.
	}

	render(width: number): string[] {
		const snapshot = this.registry.list();
		if (snapshot.length === 0) {
			return [
				this.theme.header(this.padRight("Activity", width)),
				this.theme.muted(this.padRight(EMPTY_STATE, width)),
			];
		}

		const blockerId = this.blockerId(snapshot);
		const rows: string[] = [this.theme.header(this.padRight(this.headerText(snapshot), width))];

		// Cap to maxRows, but ALWAYS include the blocker even if it would overflow.
		const visible = snapshot.slice(0, this.maxRows);
		if (blockerId && !visible.some((s) => s.id === blockerId)) {
			const blocker = snapshot.find((s) => s.id === blockerId);
			if (blocker) {
				// Drop the last visible row to make room for the blocker.
				if (visible.length >= this.maxRows) visible.pop();
				visible.push(blocker);
			}
		}
		const hiddenCount = snapshot.length - visible.length;

		for (const activity of visible) {
			rows.push(this.formatRow(activity, width, activity.id === blockerId));
		}
		if (hiddenCount > 0) {
			rows.push(this.theme.muted(this.padRight(`… +${hiddenCount} more`, width)));
		}
		return rows;
	}

	private headerText(snapshot: ActivitySnapshot[]): string {
		const running = snapshot.filter((s) => s.status === "running").length;
		const queued = snapshot.filter((s) => s.status === "queued").length;
		let header = `Activity (${running} running`;
		if (queued > 0) header += ` · ${queued} queued`;
		return `${header})`;
	}

	/**
	 * Blocker = the first running non-`model` row in the (already-sorted) list,
	 * else the first running `model` row. Mirrors registry `blockingLeaf()`.
	 */
	private blockerId(snapshot: ActivitySnapshot[]): string | undefined {
		const running = snapshot.filter((s) => s.status === "running");
		const leaf = running.find((s) => s.kind !== "model");
		return (leaf ?? running.find((s) => s.kind === "model"))?.id;
	}

	private formatRow(activity: ActivitySnapshot, width: number, isBlocker: boolean): string {
		const glyph = this.glyph(activity);
		const mark = isBlocker ? `${BLOCKER_MARK} ` : "";
		const labelText = activity.detail ? `${activity.label}: ${activity.detail}` : activity.label;
		const left = `${mark}${glyph} ${labelText}`;
		const right = this.rightColumn(activity);
		return this.theme.row(this.layoutRow(left, right, width));
	}

	private rightColumn(activity: ActivitySnapshot): string {
		let right = formatElapsed(activity.elapsedMs);
		if (activity.status === "running" && activity.stalledMs > this.stallThresholdMs) {
			right += ` · stalled ${formatElapsed(activity.stalledMs)}`;
		}
		return right;
	}

	private glyph(activity: ActivitySnapshot): string {
		switch (activity.status) {
			case "running":
				return activity.stalledMs > this.stallThresholdMs ? this.theme.accent("◍") : this.theme.accent("●");
			case "queued":
				return this.theme.muted("◌");
			case "done":
				return this.theme.muted("○");
			case "error":
				return this.theme.error("✗");
		}
	}

	private layoutRow(left: string, right: string, width: number): string {
		const leftW = visibleWidth(left);
		const rightW = visibleWidth(right);
		const gap = Math.max(1, width - leftW - rightW);
		if (leftW + rightW + 1 > width) {
			// Truncate left to make room for the right column.
			return `${this.truncateVisible(left, Math.max(0, width - rightW - 1))} ${right}`;
		}
		return `${left}${" ".repeat(gap)}${right}`;
	}

	private truncateVisible(s: string, max: number): string {
		if (visibleWidth(s) <= max) return s;
		return `${s.slice(0, Math.max(0, max - 1))}…`;
	}

	private padRight(s: string, width: number): string {
		const w = visibleWidth(s);
		if (w >= width) return s;
		return s + " ".repeat(width - w);
	}
}
