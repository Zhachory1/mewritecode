/**
 * Claude Code → caveman migration planner.
 *
 * Backs `caveman migrate --from claude`. The goal: a Claude Code user with an
 * existing `~/.claude/` reaches a working caveman session in one step, reusing
 * everything caveman can read.
 *
 * Two classes of artifact:
 *
 *   1. AUTO-REUSED (caveman already reads `~/.claude/` at runtime — nothing to
 *      copy, we only DETECT + REPORT):
 *        - MCP servers   ~/.claude/mcp.json   (agent/src/mcp/discovery.ts)
 *        - Memory index  ~/.claude/projects/<slug>/memory/MEMORY.md
 *                        (core/memory-bridge.ts; session-start prelude)
 *
 *   2. COPY-REQUIRED (caveman only scans its own `~/.cave/`, so these must be
 *      imported into the cave config dir to take effect):
 *        - skills        ~/.claude/skills/**   → <cave>/skills/
 *        - agents/subagents ~/.claude/agents/*.md → <cave>/agents/
 *        - slash commands ~/.claude/commands/*.md → <cave>/commands/
 *        - settings.json ~/.claude/settings.json → <cave>/settings.json (merge)
 *        - global memory ~/.claude/CLAUDE.md   → <cave>/CLAUDE.md
 *
 * This module is the PURE planner: it computes a `MigrationPlan` from a
 * filesystem-shaped view (`FsView`). It never writes. The CLI layer
 * (`cli/migrate-cli.ts`) applies the plan and prints the report. Keeping the
 * planning logic free of real fs I/O makes it unit-testable in isolation.
 */

import { join } from "node:path";

/** Categories of artifact handled by the migration. */
export type MigrateCategory = "skills" | "agents" | "commands" | "settings" | "memory" | "mcp";

/** What we decided to do with a single source entry. */
export type MigrateAction =
	| "import" // copy-required, destination absent → will copy
	| "skip" // copy-required, destination present → left untouched (idempotent)
	| "merge" // settings.json: keys merged, existing keys win
	| "reuse"; // auto-reused at runtime, no copy needed

export interface MigrateItem {
	category: MigrateCategory;
	/** Human label, e.g. a skill name or filename. */
	name: string;
	/** Absolute source path under `~/.claude/`. */
	from: string;
	/** Absolute destination path under the cave config dir (omitted for pure reuse). */
	to?: string;
	action: MigrateAction;
	/** Why an entry was skipped / reused, when not obvious. */
	note?: string;
}

export interface MigrationPlan {
	items: MigrateItem[];
	/** Per-category action counts, for the summary. */
	counts: Record<MigrateCategory, Record<MigrateAction, number>>;
	/** True when `~/.claude/` does not exist at all. */
	claudeMissing: boolean;
}

/**
 * Minimal filesystem view the planner needs. Implemented over real `fs` by the
 * CLI; stubbed in unit tests. All paths are absolute.
 */
export interface FsView {
	exists(path: string): boolean;
	isDirectory(path: string): boolean;
	/** Immediate entries of a directory (names only, no recursion). Empty if absent. */
	readDir(path: string): string[];
}

export interface PlanInput {
	/** `~/.claude` (absolute). */
	claudeDir: string;
	/** Cave config dir (e.g. `~/.cave/agent`), from `getAgentDir()`. */
	caveDir: string;
	fs: FsView;
}

const ALL_CATEGORIES: MigrateCategory[] = ["skills", "agents", "commands", "settings", "memory", "mcp"];

function emptyCounts(): Record<MigrateCategory, Record<MigrateAction, number>> {
	const out = {} as Record<MigrateCategory, Record<MigrateAction, number>>;
	for (const c of ALL_CATEGORIES) {
		out[c] = { import: 0, skip: 0, merge: 0, reuse: 0 };
	}
	return out;
}

/**
 * A skill lives in `~/.claude/skills/<name>/SKILL.md` (directory form) or, more
 * loosely, any subdirectory of `skills/`. We treat each immediate subdirectory
 * of `skills/` as one skill keyed by its directory name. Loose top-level `.md`
 * files are also supported (Claude Code allows flat command-style skills).
 */
function planSkills(input: PlanInput): MigrateItem[] {
	const { fs, claudeDir, caveDir } = input;
	const srcRoot = join(claudeDir, "skills");
	const dstRoot = join(caveDir, "skills");
	if (!fs.exists(srcRoot) || !fs.isDirectory(srcRoot)) return [];

	const items: MigrateItem[] = [];
	for (const entry of fs.readDir(srcRoot).sort()) {
		if (entry.startsWith(".")) continue;
		const from = join(srcRoot, entry);
		const to = join(dstRoot, entry);
		// Only treat directories or .md files as skills.
		const isDir = fs.isDirectory(from);
		if (!isDir && !entry.endsWith(".md")) continue;
		const exists = fs.exists(to);
		items.push({
			category: "skills",
			name: entry.replace(/\.md$/, ""),
			from,
			to,
			action: exists ? "skip" : "import",
			note: exists ? "destination already exists" : undefined,
		});
	}
	return items;
}

/** Flat `.md` files under a `~/.claude/<dir>/` mapped to `<cave>/<dir>/`. */
function planFlatMd(input: PlanInput, dirName: string, category: MigrateCategory): MigrateItem[] {
	const { fs, claudeDir, caveDir } = input;
	const srcRoot = join(claudeDir, dirName);
	const dstRoot = join(caveDir, dirName);
	if (!fs.exists(srcRoot) || !fs.isDirectory(srcRoot)) return [];

	const items: MigrateItem[] = [];
	for (const entry of fs.readDir(srcRoot).sort()) {
		if (!entry.endsWith(".md")) continue;
		const from = join(srcRoot, entry);
		const to = join(dstRoot, entry);
		const exists = fs.exists(to);
		items.push({
			category,
			name: entry.replace(/\.md$/, ""),
			from,
			to,
			action: exists ? "skip" : "import",
			note: exists ? "destination already exists" : undefined,
		});
	}
	return items;
}

/** `~/.claude/settings.json` → `<cave>/settings.json`. Always a merge when present. */
function planSettings(input: PlanInput): MigrateItem[] {
	const { fs, claudeDir, caveDir } = input;
	const from = join(claudeDir, "settings.json");
	if (!fs.exists(from)) return [];
	const to = join(caveDir, "settings.json");
	const dstExists = fs.exists(to);
	return [
		{
			category: "settings",
			name: "settings.json",
			from,
			to,
			// Fresh copy when no cave settings yet; otherwise a key-level merge
			// (existing cave keys always win — see mergeSettingsObjects).
			action: dstExists ? "merge" : "import",
			note: dstExists ? "merging keys; existing cave values win" : undefined,
		},
	];
}

/** `~/.claude/CLAUDE.md` (global memory) → `<cave>/CLAUDE.md`. */
function planGlobalMemory(input: PlanInput): MigrateItem[] {
	const { fs, claudeDir, caveDir } = input;
	const from = join(claudeDir, "CLAUDE.md");
	if (!fs.exists(from)) return [];
	const to = join(caveDir, "CLAUDE.md");
	const exists = fs.exists(to);
	return [
		{
			category: "memory",
			name: "CLAUDE.md",
			from,
			to,
			action: exists ? "skip" : "import",
			note: exists ? "destination already exists" : "global memory file",
		},
	];
}

/**
 * MCP is auto-reused at runtime (discovery reads `~/.claude/mcp.json`), so we
 * never copy it — we only report it as a confidence signal.
 */
function planMcpReuse(input: PlanInput): MigrateItem[] {
	const { fs, claudeDir } = input;
	const from = join(claudeDir, "mcp.json");
	if (!fs.exists(from)) return [];
	return [
		{
			category: "mcp",
			name: "mcp.json",
			from,
			action: "reuse",
			note: "read automatically at runtime — no copy needed",
		},
	];
}

/**
 * Compute the full migration plan. Pure: depends only on `input.fs`.
 */
export function planClaudeMigration(input: PlanInput): MigrationPlan {
	const counts = emptyCounts();
	if (!input.fs.exists(input.claudeDir) || !input.fs.isDirectory(input.claudeDir)) {
		return { items: [], counts, claudeMissing: true };
	}

	const items: MigrateItem[] = [
		...planSkills(input),
		...planFlatMd(input, "agents", "agents"),
		...planFlatMd(input, "commands", "commands"),
		...planSettings(input),
		...planGlobalMemory(input),
		...planMcpReuse(input),
	];

	for (const item of items) {
		counts[item.category][item.action]++;
	}

	return { items, counts, claudeMissing: false };
}

/**
 * Merge a Claude settings object into a cave settings object. Existing cave
 * keys ALWAYS win (idempotent + non-clobbering). Nested objects are merged one
 * level deep (e.g. `hooks`, `env`); arrays and scalars are taken wholesale from
 * cave when present, otherwise from claude.
 *
 * Returns the merged object plus the list of top-level keys actually adopted
 * from claude (for the report).
 */
export function mergeSettingsObjects(
	cave: Record<string, unknown>,
	claude: Record<string, unknown>,
): { merged: Record<string, unknown>; adopted: string[] } {
	const merged: Record<string, unknown> = { ...cave };
	const adopted: string[] = [];

	for (const [key, claudeVal] of Object.entries(claude)) {
		if (!(key in merged)) {
			merged[key] = claudeVal;
			adopted.push(key);
			continue;
		}
		const caveVal = merged[key];
		// One-level-deep merge for plain objects (hooks, env, statusLine, …).
		if (isPlainObject(caveVal) && isPlainObject(claudeVal)) {
			const sub: Record<string, unknown> = { ...claudeVal, ...caveVal };
			// Did we pull in any new sub-keys from claude?
			const before = Object.keys(caveVal).length;
			if (Object.keys(sub).length > before) adopted.push(key);
			merged[key] = sub;
		}
		// Otherwise cave wins (already in merged) — nothing to do.
	}

	return { merged, adopted };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Human-readable one-line summary of the plan's action counts. */
export function summarizePlan(plan: MigrationPlan): string[] {
	const lines: string[] = [];
	for (const category of ALL_CATEGORIES) {
		const c = plan.counts[category];
		const total = c.import + c.skip + c.merge + c.reuse;
		if (total === 0) continue;
		const parts: string[] = [];
		if (c.import) parts.push(`${c.import} imported`);
		if (c.merge) parts.push(`${c.merge} merged`);
		if (c.reuse) parts.push(`${c.reuse} reused`);
		if (c.skip) parts.push(`${c.skip} skipped`);
		lines.push(`${category}: ${parts.join(", ")}`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Executor — applies a MigrationPlan to a filesystem.
//
// The planner above is pure. Applying it requires *writing*, so the executor
// works against an `FsWriter` (a superset of the read-only `FsView`). Production
// uses `realFs` (a thin `node:fs` adapter); tests use an in-memory mock. The
// executor never re-derives decisions — it trusts the plan's per-item `action`,
// re-checking destination existence only to stay idempotent + non-clobbering.
// ---------------------------------------------------------------------------

/**
 * Write-capable filesystem view. Extends the read-only `FsView` the planner
 * uses with the minimum mutating operations the executor needs. All paths are
 * absolute.
 */
export interface FsWriter extends FsView {
	/** Read a file's UTF-8 contents. Throws if absent. */
	readFile(path: string): string;
	/** Write UTF-8 contents, creating parent directories as needed. */
	writeFile(path: string, contents: string): void;
	/** Recursively copy a file or directory tree to `dst`. Parents created. */
	copy(src: string, dst: string): void;
	/** Ensure a directory (and parents) exist. */
	mkdirp(path: string): void;
}

/** What the executor actually did with one planned item. */
export interface ExecutedItem {
	category: MigrateCategory;
	name: string;
	/** The action carried out (may differ from the plan if dst appeared since planning). */
	action: MigrateAction;
	from: string;
	to?: string;
	/** Keys adopted from claude settings.json (settings/merge items only). */
	adoptedKeys?: string[];
	note?: string;
}

export interface ExecuteResult {
	/** Every item the executor visited, with the action carried out. */
	items: ExecutedItem[];
	/** Per-category counts of actions actually carried out. */
	counts: Record<MigrateCategory, Record<MigrateAction, number>>;
	/** Names of copy-required items skipped because the destination existed. */
	conflictsSkipped: string[];
	/** True when nothing was written (dry-run, or every item was skip/reuse). */
	noWrites: boolean;
	dryRun: boolean;
}

export interface ExecuteOptions {
	dryRun: boolean;
	fs: FsWriter;
}

/**
 * Apply a `MigrationPlan` to the filesystem.
 *
 * Idempotent + non-clobbering:
 *   - `import`  copies only when the destination is still absent; if it appeared
 *               since planning, downgrades to `skip` (never clobbers).
 *   - `skip`    no-op.
 *   - `reuse`   no-op (already read at runtime — there is nothing to copy).
 *   - `merge`   reads cave + claude settings.json, merges (existing cave keys
 *               win), writes back. Re-running adopts nothing new → effectively a
 *               no-op once settled.
 *
 * `dryRun` performs ZERO writes: it reports what *would* happen (re-checking
 * existence so the preview is honest) without touching disk.
 */
export function executeClaudeMigration(plan: MigrationPlan, opts: ExecuteOptions): ExecuteResult {
	const { dryRun, fs } = opts;
	const items: ExecutedItem[] = [];
	const counts = emptyCounts();
	const conflictsSkipped: string[] = [];
	let wrote = false;

	for (const item of plan.items) {
		const executed = applyItem(item, fs, dryRun);
		items.push(executed);
		counts[executed.category][executed.action]++;
		if (executed.action === "skip" && (item.action === "import" || item.action === "merge")) {
			conflictsSkipped.push(`${executed.category}/${executed.name}`);
		}
		if (!dryRun && (executed.action === "import" || executed.action === "merge")) {
			wrote = true;
		}
	}

	return { items, counts, conflictsSkipped, noWrites: !wrote, dryRun };
}

function applyItem(item: MigrateItem, fs: FsWriter, dryRun: boolean): ExecutedItem {
	const base: ExecutedItem = {
		category: item.category,
		name: item.name,
		action: item.action,
		from: item.from,
		to: item.to,
		note: item.note,
	};

	switch (item.action) {
		case "reuse":
		case "skip":
			return base;

		case "import": {
			if (!item.to) return { ...base, action: "skip", note: "no destination" };
			// Re-check: never clobber a destination that appeared since planning.
			if (fs.exists(item.to)) {
				return { ...base, action: "skip", note: "destination already exists" };
			}
			if (!dryRun) fs.copy(item.from, item.to);
			return base;
		}

		case "merge": {
			if (!item.to) return { ...base, action: "skip", note: "no destination" };
			return applySettingsMerge(item, fs, dryRun);
		}

		default:
			return base;
	}
}

function applySettingsMerge(item: MigrateItem, fs: FsWriter, dryRun: boolean): ExecutedItem {
	const to = item.to as string;
	const claude = readJsonObject(fs, item.from);
	// If cave settings vanished since planning, this is a fresh copy.
	if (!fs.exists(to)) {
		if (!dryRun) fs.copy(item.from, to);
		return {
			category: item.category,
			name: item.name,
			action: "import",
			from: item.from,
			to,
			adoptedKeys: Object.keys(claude),
			note: "fresh copy (no existing cave settings)",
		};
	}
	const cave = readJsonObject(fs, to);
	const { merged, adopted } = mergeSettingsObjects(cave, claude);
	if (adopted.length === 0) {
		return {
			category: item.category,
			name: item.name,
			action: "skip",
			from: item.from,
			to,
			adoptedKeys: [],
			note: "nothing new to adopt; cave settings unchanged",
		};
	}
	if (!dryRun) fs.writeFile(to, `${JSON.stringify(merged, null, 2)}\n`);
	return {
		category: item.category,
		name: item.name,
		action: "merge",
		from: item.from,
		to,
		adoptedKeys: adopted,
		note: `adopted ${adopted.length} key(s): ${adopted.join(", ")}`,
	};
}

function readJsonObject(fs: FsWriter, path: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(fs.readFile(path));
		return isPlainObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** Human-readable summary lines for an `ExecuteResult` (mirrors summarizePlan). */
export function summarizeExecution(result: ExecuteResult): string[] {
	const lines: string[] = [];
	for (const category of ALL_CATEGORIES) {
		const c = result.counts[category];
		const total = c.import + c.skip + c.merge + c.reuse;
		if (total === 0) continue;
		const parts: string[] = [];
		if (c.import) parts.push(`${c.import} imported`);
		if (c.merge) parts.push(`${c.merge} merged`);
		if (c.reuse) parts.push(`${c.reuse} reused`);
		if (c.skip) parts.push(`${c.skip} skipped`);
		lines.push(`${category}: ${parts.join(", ")}`);
	}
	return lines;
}
