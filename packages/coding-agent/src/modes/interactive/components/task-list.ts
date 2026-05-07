/**
 * Animated todo / task-list widget.
 *
 * First-class component (promoted from `examples/extensions/todo.ts`).
 * Reference: claude-code TaskListV2.tsx:30 (377L animated transitions).
 *
 * Status icons:
 *   pending      ·  □
 *   in_progress  ·  spinner glyph (animated via setSpinnerFrame)
 *   completed    ·  ✓ (green)
 *   failed       ·  ✗ (red)
 *   blocked      ·  ⊝ (dim)
 *
 * The component is a plain `Container` over `Text` lines, so it renders the
 * same way in inline transcripts and overlays.
 */

import { Container, Text } from "@cave/tui";
import { type Theme, theme } from "../theme/theme.js";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

export interface TaskListItem {
	id: string | number;
	text: string;
	status: TaskStatus;
	subtext?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function statusIcon(status: TaskStatus, spinnerFrame: number, t: Theme): string {
	switch (status) {
		case "pending":
			return t.fg("dim", "□");
		case "in_progress":
			return t.fg("accent", SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]);
		case "completed":
			return t.fg("success", "✓");
		case "failed":
			return t.fg("error", "✗");
		case "blocked":
			return t.fg("dim", "⊝");
	}
}

export interface TaskListOptions {
	title?: string;
	showCounts?: boolean;
}

export class TaskListComponent extends Container {
	private items: TaskListItem[] = [];
	private spinnerFrame = 0;
	private headerText?: Text;
	private listContainer: Container;
	private opts: TaskListOptions;

	constructor(items: TaskListItem[] = [], opts: TaskListOptions = {}) {
		super();
		this.items = items.slice();
		this.opts = opts;

		if (opts.title) {
			this.headerText = new Text(theme.fg("accent", opts.title), 1, 0);
			this.addChild(this.headerText);
		}
		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.refresh();
	}

	setItems(items: TaskListItem[]): void {
		this.items = items.slice();
		this.refresh();
	}

	updateItem(id: string | number, patch: Partial<Omit<TaskListItem, "id">>): void {
		const idx = this.items.findIndex((i) => i.id === id);
		if (idx === -1) return;
		this.items[idx] = { ...this.items[idx], ...patch };
		this.refresh();
	}

	addItem(item: TaskListItem): void {
		this.items.push(item);
		this.refresh();
	}

	/**
	 * Advance the in-progress spinner by one frame. Caller should drive this
	 * on a 80-100ms tick (same cadence as `Spinner` in @cave/tui).
	 */
	tick(): void {
		this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
		// Only reflow when at least one task is mid-flight — saves redraws.
		if (this.items.some((i) => i.status === "in_progress")) this.refresh();
	}

	private refresh(): void {
		if (this.headerText && this.opts.showCounts !== false) {
			const done = this.items.filter((i) => i.status === "completed").length;
			const total = this.items.length;
			const title = this.opts.title ?? "Tasks";
			this.headerText.setText(theme.fg("accent", `${title} ${theme.fg("dim", `(${done}/${total})`)}`));
		}

		this.listContainer.clear();
		for (const item of this.items) {
			const icon = statusIcon(item.status, this.spinnerFrame, theme);
			const text =
				item.status === "completed"
					? theme.fg("dim", item.text) // strikethrough effect via dim
					: item.status === "failed"
						? theme.fg("error", item.text)
						: theme.fg("toolOutput", item.text);
			const line = `  ${icon}  ${text}`;
			this.listContainer.addChild(new Text(line, 1, 0));
			if (item.subtext) {
				this.listContainer.addChild(new Text(`     ${theme.fg("dim", item.subtext)}`, 1, 0));
			}
		}
	}
}
