/**
 * MEMORY.md bridge — read Claude Code's per-project memory layout into cave's
 * memory provider so the two agents see a consistent picture (WS7).
 *
 * Layout we read (Claude Code v2.1):
 *   ~/.claude/projects/<slug>/memory/MEMORY.md           ← top-level index.
 *   ~/.claude/projects/<slug>/memory/<fact>.md           ← per-fact bodies.
 *
 * <slug> is the working directory with `/` and `:` replaced by `-`. Claude
 * Code's exact slugger differs slightly across builds but always begins with
 * a single dash + the absolute path; we generate both candidate forms and
 * return the first one that exists.
 *
 * Two surfaces:
 *   readMemoryIndex()   → return up to 200 lines of the index file. Used at
 *                         session-start so cave's prelude includes the same
 *                         hand-curated list Claude Code shows the user.
 *   importFromClaudeCode() → bulk-import per-fact .md files into the active
 *                         provider as `kind:fact` observations. Triggered by
 *                         `/memory sync --from claude` and one-shot only;
 *                         duplicates are detected by a hash of the body.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { memory as memoryNs } from "@juliusbrussee/caveman-agent";

type MemoryProvider = memoryNs.MemoryProvider;

export interface ClaudeMemoryLocation {
	root: string;
	indexFile: string;
	exists: boolean;
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/**
 * Compute the candidate `~/.claude/projects/<slug>` directory(ies) for a cwd.
 * Returns the first directory that actually contains a memory subdir, plus
 * its index file path; `exists: false` when none of the candidates resolved.
 */
export function locateClaudeMemory(cwd: string, home = homedir()): ClaudeMemoryLocation {
	const projects = join(home, ".claude", "projects");
	const candidates = candidateSlugs(cwd).map((slug) => join(projects, slug));
	for (const root of candidates) {
		const memDir = join(root, "memory");
		const indexFile = join(memDir, "MEMORY.md");
		if (existsSync(indexFile)) {
			return { root: memDir, indexFile, exists: true };
		}
	}
	// Fall back to a scan of `projects/` when none of the known slug shapes
	// hit — guards against future Claude Code slugger churn.
	if (existsSync(projects)) {
		try {
			const entries = readdirSync(projects);
			for (const e of entries) {
				const memDir = join(projects, e, "memory");
				const indexFile = join(memDir, "MEMORY.md");
				if (existsSync(indexFile)) {
					const body = safeRead(indexFile, 4_096);
					if (body?.toLowerCase().includes(basename(cwd).toLowerCase())) {
						return { root: memDir, indexFile, exists: true };
					}
				}
			}
		} catch {
			/* ignore */
		}
	}
	const fallback = candidates[0] ? join(candidates[0], "memory") : projects;
	return { root: fallback, indexFile: join(fallback, "MEMORY.md"), exists: false };
}

function candidateSlugs(cwd: string): string[] {
	const abs = resolve(cwd);
	// Claude Code (observed): "-Users-julb-Desktop-GitHub-caveman-cli"
	const dashed = abs.replace(/[/:]+/g, "-");
	// Some builds prefix a duplicate dash before the volume.
	return Array.from(new Set([dashed, dashed.replace(/^-/, "--"), dashed.replace(/^-/, "")]));
}

/**
 * Read the first N lines of MEMORY.md (default 200, per the user's existing
 * workflow). Returns `undefined` when the file does not exist.
 */
export function readMemoryIndex(loc: ClaudeMemoryLocation, opts: { lines?: number } = {}): string | undefined {
	if (!loc.exists) return undefined;
	const lines = Math.max(1, Math.min(2_000, opts.lines ?? 200));
	const raw = safeRead(loc.indexFile, 1024 * 1024);
	if (!raw) return undefined;
	const split = raw.split("\n");
	return split.slice(0, lines).join("\n");
}

/**
 * Bulk-import all per-fact `.md` files from the Claude memory dir as
 * `kind:fact` observations on the cave provider. Idempotent across runs:
 * we tag each saved observation with the SHA-256 of its body so a re-run
 * won't double-write.
 */
export async function importFromClaudeCode(
	loc: ClaudeMemoryLocation,
	provider: MemoryProvider,
	opts: { dryRun?: boolean; onSkip?: (file: string) => void } = {},
): Promise<ImportResult> {
	const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
	if (!loc.exists) {
		result.errors.push(`No Claude Code memory dir at ${loc.indexFile}`);
		return result;
	}
	let entries: string[] = [];
	try {
		entries = readdirSync(loc.root);
	} catch (err) {
		result.errors.push(err instanceof Error ? err.message : String(err));
		return result;
	}

	const seenHashes = new Set<string>();
	for (const e of entries) {
		if (!e.endsWith(".md")) continue;
		if (e === "MEMORY.md") continue;
		const filePath = join(loc.root, e);
		const body = safeRead(filePath, 256 * 1024);
		if (!body) {
			result.skipped++;
			continue;
		}
		const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
		if (seenHashes.has(hash)) {
			result.skipped++;
			continue;
		}
		seenHashes.add(hash);
		if (opts.dryRun) {
			result.imported++;
			continue;
		}
		try {
			await provider.save(body, "fact", {
				source: "claude-code",
				file: e,
				body_sha256: hash,
			});
			result.imported++;
		} catch (err) {
			result.errors.push(`${e}: ${err instanceof Error ? err.message : String(err)}`);
			opts.onSkip?.(e);
			result.skipped++;
		}
	}
	return result;
}

/**
 * Compose the session-start prelude block. Returns "" if nothing is available.
 *
 * The block is wrapped in `<system-reminder>` so it lands in cave's existing
 * cache-stable layout under "[pinned]" without re-architecting the prompt.
 */
export function composeStartupPrelude(args: {
	memoryIndex?: string | undefined;
	cavememSnippet?: string | undefined;
	maxChars?: number;
}): string {
	const max = args.maxChars ?? 2_000;
	const parts: string[] = [];
	if (args.memoryIndex?.trim()) {
		parts.push("[claude-code MEMORY.md] (first 200 lines):");
		parts.push(args.memoryIndex.trim());
	}
	if (args.cavememSnippet?.trim()) {
		parts.push(args.cavememSnippet.trim());
	}
	if (parts.length === 0) return "";
	let body = parts.join("\n\n");
	if (body.length > max) body = `${body.slice(0, max - 1)}…`;
	return `<system-reminder>\n${body}\n</system-reminder>`;
}

function safeRead(path: string, maxBytes: number): string | undefined {
	try {
		const stat = statSync(path);
		if (!stat.isFile()) return undefined;
		const raw = readFileSync(path, "utf-8");
		return raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
	} catch {
		return undefined;
	}
}
