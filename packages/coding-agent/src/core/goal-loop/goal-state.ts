/**
 * State persistence for `/goal` autonomous loop. Pattern: durable goal file +
 * append-only transcript + sidecar JSON state. Fresh-process-per-iteration
 * driver re-reads GOAL.md every iteration so user can edit mid-run (Ralph
 * superpower).
 *
 * Layout: <cwd>/.cave/goal/<id>/
 *   GOAL.md           durable goal + YAML frontmatter (caps, sentinel, status)
 *   state.json        iteration counter, heartbeat, status
 *   lock.json         single-writer lock w/ stale-steal after 5min
 *   ledger.json       running cost + token totals
 *   transcript.jsonl  append-only per-iteration audit log
 *   iterations/<n>/   per-iter raw outputs
 *   SUMMARY.md        rolling 2KB summary written by previous iter
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseFrontmatter } from "../../utils/frontmatter.js";

export const DEFAULT_COMPLETION_SENTINEL = "<goal-complete/>";
export const DEFAULT_MAX_ITERATIONS = 50;
export const DEFAULT_MAX_WALL_CLOCK_HOURS = 24;
export const DEFAULT_MAX_USD = 10;
export const DEFAULT_MAX_NO_PROGRESS = 5;
export const LOCK_STALE_MS = 5 * 60 * 1000;

export type GoalStatus = "running" | "paused" | "done" | "failed" | "cancelled";

export interface GoalFrontmatter {
	id: string;
	started_at: string;
	max_iterations: number;
	max_wall_clock_h: number;
	max_usd: number;
	max_no_progress: number;
	completion_sentinel: string;
	status: GoalStatus;
	cwd: string;
	model?: string;
	[key: string]: unknown;
}

export interface GoalState {
	iteration: number;
	last_progress_iteration: number;
	last_progress_signal?: string;
	started_at: string;
	last_heartbeat: string;
	status: GoalStatus;
	finished_at?: string;
	failure_reason?: string;
}

export interface GoalLedger {
	usd: number;
	input_tokens: number;
	output_tokens: number;
	cache_create_tokens: number;
	cache_read_tokens: number;
	iterations: number;
	last_iter_usd: number;
}

export interface GoalLock {
	owner: string;
	pid: number;
	host: string;
	heartbeat_at: string;
}

export interface TranscriptEntry {
	iter: number;
	started_at: string;
	ended_at: string;
	exit_code: number;
	stop_reason?: string;
	sentinel_seen: boolean;
	usd: number;
	input_tokens: number;
	output_tokens: number;
	progress_signals: string[];
	last_assistant_excerpt: string;
}

const writeJsonAtomic = (path: string, data: unknown): void => {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}`;
	writeFileSync(tmp, JSON.stringify(data, null, 2));
	renameSync(tmp, path);
};

const readJson = <T>(path: string): T | undefined => {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
};

export interface GoalPaths {
	root: string;
	goalMd: string;
	stateJson: string;
	lockJson: string;
	ledgerJson: string;
	transcriptJsonl: string;
	summaryMd: string;
	iterationsDir: string;
}

export const goalRootDir = (cwd: string): string => join(cwd, ".cave", "goal");

export const goalPaths = (cwd: string, id: string): GoalPaths => {
	const root = join(goalRootDir(cwd), id);
	return {
		root,
		goalMd: join(root, "GOAL.md"),
		stateJson: join(root, "state.json"),
		lockJson: join(root, "lock.json"),
		ledgerJson: join(root, "ledger.json"),
		transcriptJsonl: join(root, "transcript.jsonl"),
		summaryMd: join(root, "SUMMARY.md"),
		iterationsDir: join(root, "iterations"),
	};
};

export const newGoalId = (): string => {
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const rand = Math.random().toString(36).slice(2, 8);
	return `g-${stamp}-${rand}`;
};

export const listGoals = (cwd: string): Array<{ id: string; frontmatter: GoalFrontmatter }> => {
	const root = goalRootDir(cwd);
	if (!existsSync(root)) return [];
	const out: Array<{ id: string; frontmatter: GoalFrontmatter }> = [];
	for (const id of readdirSync(root)) {
		const goalMd = join(root, id, "GOAL.md");
		if (!existsSync(goalMd)) continue;
		try {
			const { frontmatter } = parseFrontmatter<GoalFrontmatter>(readFileSync(goalMd, "utf8"));
			out.push({ id, frontmatter });
		} catch {
			// skip malformed
		}
	}
	return out.sort((a, b) => b.frontmatter.started_at.localeCompare(a.frontmatter.started_at));
};

export const writeGoalMd = (path: string, frontmatter: GoalFrontmatter, body: string): void => {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	const text = `---\n${yaml}\n---\n\n${body.trim()}\n`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};

export const readGoalMd = (path: string): { frontmatter: GoalFrontmatter; body: string } => {
	const raw = readFileSync(path, "utf8");
	const { frontmatter, body } = parseFrontmatter<GoalFrontmatter>(raw);
	return { frontmatter, body };
};

export const updateGoalFrontmatter = (path: string, patch: Partial<GoalFrontmatter>): void => {
	const { frontmatter, body } = readGoalMd(path);
	writeGoalMd(path, { ...frontmatter, ...patch }, body);
};

export const readState = (paths: GoalPaths): GoalState | undefined => readJson<GoalState>(paths.stateJson);

export const writeState = (paths: GoalPaths, state: GoalState): void => writeJsonAtomic(paths.stateJson, state);

export const readLedger = (paths: GoalPaths): GoalLedger => {
	return (
		readJson<GoalLedger>(paths.ledgerJson) ?? {
			usd: 0,
			input_tokens: 0,
			output_tokens: 0,
			cache_create_tokens: 0,
			cache_read_tokens: 0,
			iterations: 0,
			last_iter_usd: 0,
		}
	);
};

export const writeLedger = (paths: GoalPaths, ledger: GoalLedger): void => writeJsonAtomic(paths.ledgerJson, ledger);

export const appendTranscript = (paths: GoalPaths, entry: TranscriptEntry): void => {
	mkdirSync(dirname(paths.transcriptJsonl), { recursive: true });
	appendFileSync(paths.transcriptJsonl, `${JSON.stringify(entry)}\n`);
};

export const acquireLock = (paths: GoalPaths, owner: string): { ok: true } | { ok: false; held: GoalLock } => {
	const existing = readJson<GoalLock>(paths.lockJson);
	if (existing) {
		const age = Date.now() - new Date(existing.heartbeat_at).getTime();
		if (Number.isFinite(age) && age < LOCK_STALE_MS) {
			// still owned
			if (existing.pid !== process.pid) {
				return { ok: false, held: existing };
			}
		}
	}
	const lock: GoalLock = {
		owner,
		pid: process.pid,
		host: hostname(),
		heartbeat_at: new Date().toISOString(),
	};
	writeJsonAtomic(paths.lockJson, lock);
	return { ok: true };
};

export const heartbeatLock = (paths: GoalPaths, owner: string): void => {
	const lock: GoalLock = {
		owner,
		pid: process.pid,
		host: hostname(),
		heartbeat_at: new Date().toISOString(),
	};
	writeJsonAtomic(paths.lockJson, lock);
};

export const releaseLock = (paths: GoalPaths): void => {
	if (existsSync(paths.lockJson)) {
		unlinkSync(paths.lockJson);
	}
};

export const readSummary = (paths: GoalPaths): string => {
	if (!existsSync(paths.summaryMd)) return "";
	return readFileSync(paths.summaryMd, "utf8");
};

export const writeSummary = (paths: GoalPaths, text: string): void => {
	mkdirSync(dirname(paths.summaryMd), { recursive: true });
	const trimmed = text.length > 2048 ? `${text.slice(0, 2048)}\n…` : text;
	writeFileSync(paths.summaryMd, trimmed);
};

export const isLockOwnedByUs = (paths: GoalPaths): boolean => {
	const lock = readJson<GoalLock>(paths.lockJson);
	return lock?.pid === process.pid;
};

export const parseGoalIdArg = (cwd: string, arg?: string): string | undefined => {
	if (arg) {
		const direct = join(goalRootDir(cwd), arg);
		if (existsSync(direct)) return arg;
		// prefix match
		const root = goalRootDir(cwd);
		if (!existsSync(root)) return undefined;
		const matches = readdirSync(root).filter((d) => d.startsWith(arg));
		return matches.length === 1 ? matches[0] : undefined;
	}
	const all = listGoals(cwd);
	return all[0]?.id;
};

// Re-export YAML parse for callers building frontmatter elsewhere
export { parseYaml, stringifyYaml };
