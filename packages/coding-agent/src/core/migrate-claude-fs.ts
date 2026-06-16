/**
 * Real-filesystem adapter for the Claude → caveman migration executor.
 *
 * `migrate-claude.ts` is pure: it talks to an `FsView` / `FsWriter` interface so
 * the planner and executor are unit-testable without touching disk. This module
 * is the only place those interfaces are bound to `node:fs`, plus the helpers
 * that resolve the two real directories the migration operates on:
 *
 *   - the Claude Code config dir  (`~/.claude`)
 *   - the caveman config dir      (`getAgentDir()`)
 */

import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "../config.js";
import type { FsWriter } from "./migrate-claude.js";

/**
 * `~/.claude` — the Claude Code config root. Mirrors how `memory-bridge.ts`
 * locates Claude's per-project memory (`join(home, ".claude", ...)`), so the
 * two stay in lock-step. `home` is injectable for tests.
 */
export function getClaudeDir(home: string = homedir()): string {
	return join(home, ".claude");
}

/** The caveman config dir the migration imports into (e.g. `~/.cave/agent`). */
export function getCaveDir(): string {
	return getAgentDir();
}

/** A `FsWriter` backed by `node:fs`. The production adapter. */
export const realFs: FsWriter = {
	exists(path: string): boolean {
		return existsSync(path);
	},
	isDirectory(path: string): boolean {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
	readDir(path: string): string[] {
		try {
			return readdirSync(path);
		} catch {
			return [];
		}
	},
	readFile(path: string): string {
		return readFileSync(path, "utf8");
	},
	writeFile(path: string, contents: string): void {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents, "utf8");
	},
	copy(src: string, dst: string): void {
		mkdirSync(dirname(dst), { recursive: true });
		const isDir = (() => {
			try {
				return statSync(src).isDirectory();
			} catch {
				return false;
			}
		})();
		if (isDir) {
			cpSync(src, dst, { recursive: true, errorOnExist: false, force: false });
		} else {
			copyFileSync(src, dst);
		}
	},
	mkdirp(path: string): void {
		mkdirSync(path, { recursive: true });
	},
};
