/**
 * Git worktree primitives for subagent isolation.
 *
 * Used by WS6 (Subagents & Plan Mode). When a subagent's frontmatter declares
 * `isolation: worktree`, the runtime spawns it inside a fresh git worktree
 * created here, so its edits live on a side branch and never collide with the
 * parent session's working tree. After the subagent finishes, if no commits
 * were made, the worktree is auto-cleaned up.
 *
 * Source check: upstream ships a subagent example
 * (`packages/coding-agent/examples/extensions/subagent/`) but it does not use
 * git worktrees; it spawns plain JSON-mode child processes. Worktree
 * isolation is Me Write Code-specific (see plan §6 WS6). We keep the API minimal and
 * test-friendly: every public function takes the `git` binary path + cwd
 * explicitly so it can be exercised in CI without polluting the developer's
 * own worktrees.
 *
 * Borrowed patterns:
 *   - Sketch's containerized parallel-session model (plan §6 stretch) — we
 *     reproduce its reproducible-side-branch idea but with git worktrees, not
 *     Docker, since Docker is not on every dev machine.
 *
 * Public surface:
 *   - createWorktree(opts)   — `git worktree add` with a fresh branch
 *   - removeWorktree(opts)   — `git worktree remove --force` + branch cleanup
 *   - hasUncommittedChanges  — used by auto-cleanup logic
 *   - getWorktreeRoot        — derive the canonical worktree dir for an id
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeOptions {
	/** Repo root containing `.git`. */
	repoRoot: string;
	/** Stable id for the subagent run. Used in branch + dir naming. */
	id: string;
	/** Branch to base the worktree on. Defaults to current HEAD. */
	baseRef?: string;
	/** Override the worktree directory. Defaults to `<repoRoot>/.cave/worktrees/<id>`. */
	worktreeDir?: string;
	/** Override the branch name. Defaults to `cave/agent/<id>`. */
	branchName?: string;
	/** Path to git binary. Defaults to `git`. */
	gitBin?: string;
}

export interface CreateWorktreeResult {
	worktreeDir: string;
	branchName: string;
	baseRef: string;
}

export interface RemoveWorktreeOptions {
	repoRoot: string;
	worktreeDir: string;
	branchName?: string;
	gitBin?: string;
	/** If true, also delete the branch. */
	deleteBranch?: boolean;
}

/** Compute the canonical worktree directory for a given id. */
export function getWorktreeRoot(repoRoot: string, id: string): string {
	return resolve(repoRoot, ".cave", "worktrees", id);
}

/** Sanitize an id into a valid git ref segment. */
export function sanitizeId(id: string): string {
	const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "agent";
}

async function run(gitBin: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync(gitBin, args, { cwd, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 });
	return { stdout, stderr };
}

/**
 * Create a fresh git worktree at `<repoRoot>/.cave/worktrees/<id>` on a new
 * branch `cave/agent/<id>` based off `baseRef`.
 *
 * Idempotent: if a worktree already exists at the target dir, returns its
 * recorded branch instead of failing.
 */
export async function createWorktree(opts: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
	const gitBin = opts.gitBin ?? "git";
	const id = sanitizeId(opts.id);
	const worktreeDir = opts.worktreeDir ?? getWorktreeRoot(opts.repoRoot, id);
	const branchName = opts.branchName ?? `cave/agent/${id}`;
	const baseRef = opts.baseRef ?? (await getCurrentHead(gitBin, opts.repoRoot));

	mkdirSync(dirname(worktreeDir), { recursive: true });

	if (existsSync(worktreeDir)) {
		// Already exists — assume it was created by a prior aborted run.
		// Return the existing branch.
		try {
			const head = await run(gitBin, ["rev-parse", "--abbrev-ref", "HEAD"], worktreeDir);
			return { worktreeDir, branchName: head.stdout.trim() || branchName, baseRef };
		} catch {
			// fallthrough to remove + recreate
			try {
				rmSync(worktreeDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}

	// `git worktree add -b <branch> <dir> <base>`
	await run(gitBin, ["worktree", "add", "-b", branchName, worktreeDir, baseRef], opts.repoRoot);

	return { worktreeDir, branchName, baseRef };
}

/** Return current HEAD as a sha; falls back to "HEAD" string. */
async function getCurrentHead(gitBin: string, repoRoot: string): Promise<string> {
	try {
		const { stdout } = await run(gitBin, ["rev-parse", "HEAD"], repoRoot);
		return stdout.trim() || "HEAD";
	} catch {
		return "HEAD";
	}
}

/**
 * Remove a worktree. Always uses `--force` because subagents may leave
 * untracked scratch files we want to throw away.
 */
export async function removeWorktree(opts: RemoveWorktreeOptions): Promise<void> {
	const gitBin = opts.gitBin ?? "git";
	if (!existsSync(opts.worktreeDir)) return;
	try {
		await run(gitBin, ["worktree", "remove", "--force", opts.worktreeDir], opts.repoRoot);
	} catch {
		// Worktree wasn't tracked by git anymore — fall back to rm -rf.
		try {
			rmSync(opts.worktreeDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
	// Always prune in case the worktree DB has stale entries.
	try {
		await run(gitBin, ["worktree", "prune"], opts.repoRoot);
	} catch {
		/* ignore */
	}
	if (opts.deleteBranch && opts.branchName) {
		try {
			await run(gitBin, ["branch", "-D", opts.branchName], opts.repoRoot);
		} catch {
			/* ignore — branch may not exist */
		}
	}
}

/**
 * Check whether a worktree has any commits beyond its base ref or any
 * uncommitted changes. Used by auto-cleanup to decide whether to keep the
 * worktree around for the user to inspect.
 */
export async function hasUncommittedChanges(opts: {
	worktreeDir: string;
	baseRef: string;
	gitBin?: string;
}): Promise<boolean> {
	const gitBin = opts.gitBin ?? "git";
	if (!existsSync(opts.worktreeDir)) return false;
	try {
		// porcelain status: any output means dirty.
		const { stdout: status } = await run(gitBin, ["status", "--porcelain"], opts.worktreeDir);
		if (status.trim().length > 0) return true;
	} catch {
		return false;
	}
	try {
		// any commits on top of base?
		const { stdout: aheadCount } = await run(
			gitBin,
			["rev-list", "--count", `${opts.baseRef}..HEAD`],
			opts.worktreeDir,
		);
		const n = parseInt(aheadCount.trim(), 10);
		if (Number.isFinite(n) && n > 0) return true;
	} catch {
		/* fallthrough */
	}
	return false;
}

/**
 * Auto-cleanup: remove the worktree only if it made no commits and has no
 * uncommitted changes. Otherwise leave it for the user.
 */
export async function autoCleanupWorktree(opts: {
	repoRoot: string;
	worktreeDir: string;
	branchName: string;
	baseRef: string;
	gitBin?: string;
}): Promise<{ cleaned: boolean }> {
	const dirty = await hasUncommittedChanges({
		worktreeDir: opts.worktreeDir,
		baseRef: opts.baseRef,
		gitBin: opts.gitBin,
	});
	if (dirty) return { cleaned: false };
	await removeWorktree({
		repoRoot: opts.repoRoot,
		worktreeDir: opts.worktreeDir,
		branchName: opts.branchName,
		gitBin: opts.gitBin,
		deleteBranch: true,
	});
	return { cleaned: true };
}

/**
 * Best-effort detection: is `dir` inside a git repo? Returns the repo root
 * when it is, otherwise null. Used by Task tool to decide whether worktree
 * isolation is even possible.
 */
export async function detectRepoRoot(dir: string, gitBin = "git"): Promise<string | null> {
	try {
		const { stdout } = await run(gitBin, ["rev-parse", "--show-toplevel"], dir);
		const root = stdout.trim();
		return root || null;
	} catch {
		return null;
	}
}

/** Default branch namespace for cave subagent worktrees. */
export const CAVE_AGENT_BRANCH_PREFIX = "cave/agent/";

/** Default worktrees subtree under .cave/. */
export function caveWorktreesDir(repoRoot: string): string {
	return join(repoRoot, ".cave", "worktrees");
}
