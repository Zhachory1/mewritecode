// WS6: git worktree primitives — sandboxed integration tests.
//
// We create a real, throwaway git repo in os.tmpdir() and exercise
// createWorktree / removeWorktree / hasUncommittedChanges /
// autoCleanupWorktree against it. No state escapes /tmp.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	autoCleanupWorktree,
	CAVE_AGENT_BRANCH_PREFIX,
	caveWorktreesDir,
	createWorktree,
	detectRepoRoot,
	getWorktreeRoot,
	hasUncommittedChanges,
	removeWorktree,
	sanitizeId,
} from "../worktree.js";

let repoRoot: string;

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

beforeEach(() => {
	repoRoot = mkdtempSync(join(tmpdir(), "cave-worktree-test-"));
	git(["init", "-b", "main"], repoRoot);
	git(["config", "user.email", "test@cave.local"], repoRoot);
	git(["config", "user.name", "cave-test"], repoRoot);
	git(["config", "commit.gpgsign", "false"], repoRoot);
	writeFileSync(join(repoRoot, "README.md"), "# test\n");
	git(["add", "."], repoRoot);
	git(["commit", "-m", "initial"], repoRoot);
});

afterEach(() => {
	if (repoRoot && existsSync(repoRoot)) {
		try {
			rmSync(repoRoot, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

describe("sanitizeId", () => {
	it("removes unsafe characters", () => {
		expect(sanitizeId("foo bar")).toBe("foo-bar");
		expect(sanitizeId("foo/bar:baz")).toBe("foo-bar-baz");
		expect(sanitizeId("--hello--")).toBe("hello");
	});

	it("falls back to 'agent' when fully empty", () => {
		expect(sanitizeId("")).toBe("agent");
		expect(sanitizeId("///")).toBe("agent");
	});

	it("preserves valid characters", () => {
		expect(sanitizeId("explore-1")).toBe("explore-1");
		expect(sanitizeId("test_v2.5")).toBe("test_v2.5");
	});
});

describe("getWorktreeRoot + caveWorktreesDir", () => {
	it("yields predictable paths", () => {
		expect(getWorktreeRoot("/repo", "alpha")).toBe("/repo/.cave/worktrees/alpha");
		expect(caveWorktreesDir("/repo")).toBe("/repo/.cave/worktrees");
	});

	it("accepts a branded config dir", () => {
		expect(getWorktreeRoot("/repo", "alpha", ".roktcode")).toBe("/repo/.roktcode/worktrees/alpha");
		expect(caveWorktreesDir("/repo", ".roktcode")).toBe("/repo/.roktcode/worktrees");
	});
});

describe("CAVE_AGENT_BRANCH_PREFIX", () => {
	it("is the documented prefix", () => {
		expect(CAVE_AGENT_BRANCH_PREFIX).toBe("cave/agent/");
	});
});

describe("detectRepoRoot", () => {
	it("returns the repo root from inside it", async () => {
		const root = await detectRepoRoot(repoRoot);
		// macOS may resolve /var → /private/var symlink; just ensure non-null and shares basename.
		expect(root).not.toBeNull();
		expect(root!.endsWith(repoRoot.split("/").pop()!)).toBe(true);
	});

	it("returns null outside any repo", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "cave-no-repo-"));
		try {
			expect(await detectRepoRoot(tmp)).toBeNull();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("createWorktree", () => {
	it("creates a fresh worktree on a new branch", async () => {
		const result = await createWorktree({ repoRoot, id: "alpha", configDirName: ".roktcode" });
		expect(result.worktreeDir).toBe(join(repoRoot, ".roktcode", "worktrees", "alpha"));
		expect(result.branchName).toBe("cave/agent/alpha");
		expect(existsSync(result.worktreeDir)).toBe(true);
		// Verify git knows about it.
		const branches = git(["branch", "--list"], repoRoot);
		expect(branches).toContain("cave/agent/alpha");
	});

	it("sanitizes ids with unsafe characters", async () => {
		const result = await createWorktree({ repoRoot, id: "feat/login bug" });
		expect(result.branchName).toMatch(/^cave\/agent\/feat-login-bug$/);
	});

	it("is idempotent: returns the existing branch when worktree already exists", async () => {
		const first = await createWorktree({ repoRoot, id: "beta" });
		const second = await createWorktree({ repoRoot, id: "beta" });
		expect(second.worktreeDir).toBe(first.worktreeDir);
	});
});

describe("hasUncommittedChanges", () => {
	it("returns false on a clean worktree", async () => {
		const wt = await createWorktree({ repoRoot, id: "clean" });
		const dirty = await hasUncommittedChanges({ worktreeDir: wt.worktreeDir, baseRef: wt.baseRef });
		expect(dirty).toBe(false);
	});

	it("returns true when an untracked file is added", async () => {
		const wt = await createWorktree({ repoRoot, id: "dirty" });
		writeFileSync(join(wt.worktreeDir, "scratch.txt"), "hello");
		const dirty = await hasUncommittedChanges({ worktreeDir: wt.worktreeDir, baseRef: wt.baseRef });
		expect(dirty).toBe(true);
	});

	it("returns true when a commit is made on top of base", async () => {
		const wt = await createWorktree({ repoRoot, id: "committed" });
		writeFileSync(join(wt.worktreeDir, "new.txt"), "hi");
		git(["add", "."], wt.worktreeDir);
		git(["commit", "-m", "agent change"], wt.worktreeDir);
		const dirty = await hasUncommittedChanges({ worktreeDir: wt.worktreeDir, baseRef: wt.baseRef });
		expect(dirty).toBe(true);
	});
});

describe("removeWorktree", () => {
	it("removes the worktree dir", async () => {
		const wt = await createWorktree({ repoRoot, id: "remove-me" });
		expect(existsSync(wt.worktreeDir)).toBe(true);
		await removeWorktree({ repoRoot, worktreeDir: wt.worktreeDir });
		expect(existsSync(wt.worktreeDir)).toBe(false);
	});

	it("optionally deletes the branch", async () => {
		const wt = await createWorktree({ repoRoot, id: "branch-too" });
		await removeWorktree({
			repoRoot,
			worktreeDir: wt.worktreeDir,
			branchName: wt.branchName,
			deleteBranch: true,
		});
		const branches = git(["branch", "--list"], repoRoot);
		expect(branches).not.toContain(wt.branchName);
	});
});

describe("autoCleanupWorktree", () => {
	it("cleans up a clean worktree", async () => {
		const wt = await createWorktree({ repoRoot, id: "auto-clean" });
		const result = await autoCleanupWorktree({
			repoRoot,
			worktreeDir: wt.worktreeDir,
			branchName: wt.branchName,
			baseRef: wt.baseRef,
		});
		expect(result.cleaned).toBe(true);
		expect(existsSync(wt.worktreeDir)).toBe(false);
	});

	it("preserves a worktree with commits", async () => {
		const wt = await createWorktree({ repoRoot, id: "keep-me" });
		writeFileSync(join(wt.worktreeDir, "kept.txt"), "yes");
		git(["add", "."], wt.worktreeDir);
		git(["commit", "-m", "kept"], wt.worktreeDir);
		const result = await autoCleanupWorktree({
			repoRoot,
			worktreeDir: wt.worktreeDir,
			branchName: wt.branchName,
			baseRef: wt.baseRef,
		});
		expect(result.cleaned).toBe(false);
		expect(existsSync(wt.worktreeDir)).toBe(true);
	});
});
