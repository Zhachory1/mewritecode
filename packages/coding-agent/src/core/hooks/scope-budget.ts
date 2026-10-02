import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FILES = 8;
const MAX_NEW_FILES = 4;
const MAX_ADDED_LINES = 300;

type Change = { path: string; isNew: boolean; addedLines: number };

function lines(text: string): number {
	return text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
}

/** Counts only successful edits by this session, not unrelated work in the worktree. */
export class ScopeBudget {
	private readonly changed = new Set<string>();
	private readonly newFiles = new Set<string>();
	private readonly pending = new Map<string, Change>();
	private addedLines = 0;

	constructor(private readonly cwd: string) {}

	reserve(id: string, tool: "edit" | "write", input: Record<string, unknown>): string | undefined {
		if (process.env.CAVE_SCOPE_BUDGET === "off" || typeof input.path !== "string") return;
		const path = resolve(this.cwd, input.path);
		const target = relative(this.cwd, path);
		if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) return;
		const isNew = !existsSync(path);
		let addedLines = 0;
		if (tool === "write" && typeof input.content === "string") {
			const previous = !isNew && statSync(path).size < 1024 * 1024 ? readFileSync(path, "utf8") : "";
			addedLines = Math.max(0, lines(input.content) - lines(previous));
		} else if (tool === "edit" && Array.isArray(input.edits)) {
			addedLines = input.edits.reduce((sum, edit) => {
				const patch = edit as { oldText?: string; newText?: string };
				return sum + Math.max(0, lines(patch.newText ?? "") - lines(patch.oldText ?? ""));
			}, 0);
		}
		const inFlight = [...this.pending.values()];
		const files = new Set([...this.changed, ...inFlight.map((p) => p.path), path]);
		const newFiles = new Set([...this.newFiles, ...inFlight.filter((p) => p.isNew).map((p) => p.path)]);
		if (isNew) newFiles.add(path);
		const totalLines = this.addedLines + inFlight.reduce((sum, p) => sum + p.addedLines, 0) + addedLines;
		if (files.size > MAX_FILES || newFiles.size > MAX_NEW_FILES || totalLines > MAX_ADDED_LINES) {
			if (!this.changed.has(path) || addedLines > 0) {
				return `Scope budget reached (${files.size} files, ${newFiles.size} new, +${totalLines} lines; limits ${MAX_FILES}/${MAX_NEW_FILES}/${MAX_ADDED_LINES}). Shrink the change or ask the user before expanding scope. For an explicitly larger task, start with CAVE_SCOPE_BUDGET=off.`;
			}
		}
		this.pending.set(id, { path, isNew, addedLines });
	}

	finish(id: string, succeeded: boolean): void {
		const change = this.pending.get(id);
		this.pending.delete(id);
		if (!change || !succeeded) return;
		this.changed.add(change.path);
		if (change.isNew) this.newFiles.add(change.path);
		this.addedLines += change.addedLines;
	}
}
