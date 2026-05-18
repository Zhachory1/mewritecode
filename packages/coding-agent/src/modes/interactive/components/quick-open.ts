/**
 * Quick-open file picker (cmd-style ⌘P).
 *
 * Lists tracked files (`git ls-files`) when the current dir is a git repo,
 * otherwise walks up to MAX_FILES entries from `cwd` skipping `node_modules`,
 * `.git`, build outputs. The user types to fuzzy-filter; Enter inserts the
 * picked path as `@<path>` into the editor.
 *
 * Reference: claude-code components/QuickOpenDialog.tsx (243L).
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Container, Spacer, Text, type TUI } from "@juliusbrussee/caveman-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { rawKeyHint } from "./keybinding-hints.js";

const MAX_FILES = 5_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "target", ".turbo", ".next"]);

export interface QuickOpenOptions {
	tui?: TUI;
	limit?: number;
}

export interface QuickOpenResult {
	relativePath: string;
}

function listGitFiles(cwd: string): string[] | null {
	try {
		const out = execSync("git ls-files --cached --others --exclude-standard", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2000,
			maxBuffer: 1024 * 1024 * 4,
		})
			.toString("utf-8")
			.split("\n")
			.filter(Boolean);
		return out;
	} catch {
		return null;
	}
}

function walkFs(cwd: string, limit: number): string[] {
	const out: string[] = [];
	const stack: string[] = [cwd];
	while (stack.length > 0 && out.length < limit) {
		const dir = stack.pop()!;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (out.length >= limit) break;
			if (SKIP_DIRS.has(entry)) continue;
			const full = join(dir, entry);
			let s: ReturnType<typeof statSync>;
			try {
				s = statSync(full);
			} catch {
				continue;
			}
			if (s.isDirectory()) {
				stack.push(full);
			} else if (s.isFile()) {
				out.push(relative(cwd, full));
			}
		}
	}
	return out;
}

/**
 * Cheap subsequence-style fuzzy match. Returns the score (lower = better
 * match) or null when the query characters don't appear in order.
 */
function fuzzyScore(query: string, target: string): number | null {
	if (!query) return 0;
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	let qi = 0;
	let lastIdx = -1;
	let score = 0;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			score += lastIdx === -1 ? ti : ti - lastIdx; // gap penalty
			lastIdx = ti;
			qi++;
		}
	}
	return qi === q.length ? score : null;
}

export class QuickOpenComponent extends Container {
	private files: string[];
	private filtered: string[];
	private query = "";
	private selectedIndex = 0;
	private listContainer: Container;
	private titleText: Text;
	private queryText: Text;
	private onSelectCallback: (result: QuickOpenResult) => void;
	private onCancelCallback: () => void;
	private maxVisible = 12;

	constructor(
		cwd: string,
		onSelect: (result: QuickOpenResult) => void,
		onCancel: () => void,
		opts?: QuickOpenOptions,
	) {
		super();
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		const limit = opts?.limit ?? MAX_FILES;
		this.files = listGitFiles(cwd) ?? walkFs(cwd, limit);
		this.filtered = this.files.slice(0, this.maxVisible);

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.titleText = new Text(theme.fg("accent", `Quick open — ${this.files.length} files`), 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		this.queryText = new Text(theme.fg("dim", "type to filter…"), 1, 0);
		this.addChild(this.queryText);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		const hints = `${rawKeyHint("↑/↓", "navigate")} · ${rawKeyHint("enter", "pick")} · ${rawKeyHint("esc", "cancel")}`;
		this.addChild(new Text(theme.fg("dim", hints), 1, 0));

		this.refreshList();
	}

	private refreshList(): void {
		this.listContainer.clear();
		const visible = this.filtered.slice(0, this.maxVisible);
		for (let i = 0; i < visible.length; i++) {
			const path = visible[i];
			const text = i === this.selectedIndex ? theme.fg("accent", `▸ ${path}`) : theme.fg("toolOutput", `  ${path}`);
			this.listContainer.addChild(new Text(text, 1, 0));
		}
		if (this.filtered.length > this.maxVisible) {
			this.listContainer.addChild(
				new Text(theme.fg("dim", `  … ${this.filtered.length - this.maxVisible} more`), 1, 0),
			);
		}
	}

	private applyFilter(): void {
		if (!this.query) {
			this.filtered = this.files.slice(0, MAX_FILES);
		} else {
			const scored: Array<[number, string]> = [];
			for (const f of this.files) {
				const s = fuzzyScore(this.query, f);
				if (s !== null) scored.push([s, f]);
			}
			scored.sort((a, b) => a[0] - b[0]);
			this.filtered = scored.map((x) => x[1]);
		}
		this.selectedIndex = 0;
		this.refreshList();
	}

	handleInput(data: string): boolean {
		if (data === "\x1b") {
			this.onCancelCallback();
			return true;
		}
		if (data === "\r" || data === "\n") {
			const pick = this.filtered[this.selectedIndex];
			if (pick) this.onSelectCallback({ relativePath: pick });
			return true;
		}
		if (data === "\x7f") {
			// backspace
			this.query = this.query.slice(0, -1);
			this.queryText.setText(this.query ? theme.fg("toolOutput", this.query) : theme.fg("dim", "type to filter…"));
			this.applyFilter();
			return true;
		}
		if (data === "\x1b[A") {
			// up
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.refreshList();
			}
			return true;
		}
		if (data === "\x1b[B") {
			// down
			if (this.selectedIndex < this.filtered.length - 1) {
				this.selectedIndex++;
				this.refreshList();
			}
			return true;
		}
		// printable: append to query
		if (data.length === 1 && data >= " " && data !== "\x7f") {
			this.query += data;
			this.queryText.setText(theme.fg("toolOutput", this.query));
			this.applyFilter();
			return true;
		}
		return false;
	}
}
