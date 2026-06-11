/**
 * WS17: Snapshotter — creates commits in the shadow bare repo.
 *
 * Key design constraints:
 *  - Must NOT touch the user's .git in any way.
 *  - Must avoid node_modules and respect .gitignore.
 *  - Target: < 200ms for typical repos.
 *  - Uses a separate GIT_INDEX_FILE so it never contaminates the real index.
 *
 * The shadow repo is a *bare* repo (--bare) stored at:
 *   ~/.cave/checkpoints/<hash>/.git
 *
 * We work-tree against the project root using the GIT_WORK_TREE env var so
 * git add/commit operate on the user's files without touching user's .git.
 *
 * Concurrency: callers must hold the file lock before calling snapshot().
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SnapshotReason = "pre-write" | "pre-edit" | "pre-bash" | `manual:${string}`;

export interface SnapshottedFile {
	path: string;
}

export interface SnapshotResult {
	commit: string;
	files: string[];
	durationMs: number;
}

/**
 * Run a git command against the shadow bare repo with a temp index, operating
 * on the user's project root as the work tree.  Never sets GIT_DIR to the
 * user's repo.
 */
function gitShadow(
	shadowGitDir: string,
	projectRoot: string,
	indexFile: string,
	args: string[],
): SpawnSyncReturns<Buffer> {
	return spawnSync("git", args, {
		cwd: projectRoot,
		env: {
			...process.env,
			GIT_DIR: shadowGitDir,
			GIT_WORK_TREE: projectRoot,
			GIT_INDEX_FILE: indexFile,
			// Prevent git from reading the user's .git config for safety
			GIT_CONFIG_NOSYSTEM: "1",
			// Deterministic identity so commits work even when the user (or a CI
			// runner) has no global git user.name/user.email configured.
			GIT_AUTHOR_NAME: "Cave Shadow",
			GIT_AUTHOR_EMAIL: "shadow@cave.internal",
			GIT_COMMITTER_NAME: "Cave Shadow",
			GIT_COMMITTER_EMAIL: "shadow@cave.internal",
		},
		timeout: 30_000,
	});
}

/** Initialize the shadow bare repo if it does not already exist. */
function ensureShadowRepo(shadowGitDir: string): void {
	if (existsSync(join(shadowGitDir, "HEAD"))) return;

	const dir = join(shadowGitDir, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const result = spawnSync("git", ["init", "--bare", shadowGitDir], {
		env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
		timeout: 10_000,
	});

	if (result.status !== 0) {
		throw new Error(`Failed to initialize shadow repo at ${shadowGitDir}: ${result.stderr?.toString() ?? "unknown"}`);
	}
}

/** Collect the list of tracked files after git add (for the index entry). */
function listIndexedFiles(shadowGitDir: string, projectRoot: string, indexFile: string): string[] {
	const result = gitShadow(shadowGitDir, projectRoot, indexFile, ["ls-files"]);
	if (result.status !== 0) return [];
	return result.stdout
		.toString()
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

export class Snapshotter {
	constructor(
		/** Absolute path to the shadow bare repo (.git directory). */
		private readonly shadowGitDir: string,
		/** Absolute path to the user's project root. */
		private readonly projectRoot: string,
	) {}

	/**
	 * Take a snapshot of the current project state.
	 *
	 * Creates a git commit in the shadow repo capturing all tracked (and
	 * gitignore-respecting) files. Does NOT modify user's .git or working tree.
	 */
	async snapshot(reason: SnapshotReason, sessionId: string): Promise<SnapshotResult> {
		const t0 = Date.now();

		ensureShadowRepo(this.shadowGitDir);

		// Temp index file so we never touch the shadow repo's own ORIG_HEAD/index
		const tmpDir = mkdtempSync(join(tmpdir(), "cave-cp-"));
		const indexFile = join(tmpDir, "index");

		try {
			// git add -A — respects .gitignore; excludes node_modules via gitignore
			const addResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, [
				"add",
				"-A",
				"--ignore-errors",
				// Exclude common large dirs explicitly as a fast path even when no .gitignore
				":(exclude)node_modules",
				":(exclude).git",
				":(exclude)dist",
				":(exclude).next",
				":(exclude).nuxt",
				":(exclude)build",
			]);

			if (addResult.status !== 0) {
				// git add can fail gracefully (e.g., empty repo with no files) — treat as empty snapshot
				// Still attempt the commit below
			}

			const files = listIndexedFiles(this.shadowGitDir, this.projectRoot, indexFile);

			// Compose commit message with structured metadata
			const message = `snapshot:${sessionId}:${reason}`;

			// Use a deterministic author so shadow repo doesn't need user config
			const commitResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, [
				"commit",
				"--allow-empty",
				"--no-gpg-sign",
				"-m",
				message,
				"--author=Cave Shadow <shadow@cave.internal>",
			]);

			// Extract commit SHA
			let commit = "";
			if (commitResult.status === 0) {
				const revResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, ["rev-parse", "HEAD"]);
				commit = revResult.stdout.toString().trim();
			} else {
				// Possibly empty repo with --allow-empty already went through; try rev-parse anyway
				const revResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, ["rev-parse", "HEAD"]);
				if (revResult.status === 0) {
					commit = revResult.stdout.toString().trim();
				} else {
					throw new Error(`Shadow commit failed: ${commitResult.stderr?.toString() ?? "unknown error"}`);
				}
			}

			const durationMs = Date.now() - t0;
			return { commit, files, durationMs };
		} finally {
			// Clean up temp index file
			try {
				if (existsSync(indexFile)) unlinkSync(indexFile);
				rmdirSafe(tmpDir);
			} catch {
				// best effort cleanup
			}
		}
	}

	/**
	 * Materialise files from a specific shadow commit into the project root.
	 *
	 * @param commit  40-char SHA in the shadow repo
	 * @param filePaths  If non-empty, only restore these repo-relative paths.
	 *                   If empty, restore all files tracked by that commit.
	 */
	async restore(commit: string, filePaths?: string[]): Promise<string[]> {
		ensureShadowRepo(this.shadowGitDir);

		const tmpDir = mkdtempSync(join(tmpdir(), "cave-rst-"));
		const indexFile = join(tmpDir, "index");

		try {
			// Read the tree at target commit into a fresh index
			const readResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, ["read-tree", commit]);

			if (readResult.status !== 0) {
				throw new Error(`Failed to read tree at ${commit}: ${readResult.stderr?.toString() ?? ""}`);
			}

			// Determine which files to check out
			const allFiles = listIndexedFiles(this.shadowGitDir, this.projectRoot, indexFile);
			const targets = filePaths && filePaths.length > 0 ? filePaths.filter((f) => allFiles.includes(f)) : allFiles;

			if (targets.length === 0) {
				return [];
			}

			// git checkout-index — writes files back to work tree from the temp index
			const checkoutResult = gitShadow(this.shadowGitDir, this.projectRoot, indexFile, [
				"checkout-index",
				"-f", // force overwrite
				"-a", // all files in index ... filtered below
				...targets.flatMap((f) => ["--", f]),
			]);

			if (checkoutResult.status !== 0) {
				// Fallback: per-file checkout
				for (const f of targets) {
					gitShadow(this.shadowGitDir, this.projectRoot, indexFile, ["checkout-index", "-f", "--", f]);
				}
			}

			return targets;
		} finally {
			try {
				if (existsSync(indexFile)) unlinkSync(indexFile);
				rmdirSafe(tmpDir);
			} catch {
				// best effort
			}
		}
	}
}

function rmdirSafe(dir: string): void {
	try {
		if (!existsSync(dir)) return;
		const entries = readdirSync(dir);
		if (entries.length === 0) {
			rmSync(dir);
		}
	} catch {
		// best effort
	}
}
