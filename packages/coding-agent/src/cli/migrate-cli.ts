/**
 * `caveman migrate --from claude [--dry-run]` — one-step Claude Code → caveman
 * config migration (issue #15). A lightweight, session-free subcommand: it boots
 * fast, reuses what caveman already reads at runtime (MCP, memory), and imports
 * the copy-required artifacts (skills, agents, commands, settings, global memory)
 * from `~/.claude/` into the cave config dir.
 *
 * The planning + execution logic lives in `core/migrate-claude.ts` (pure, against
 * an `FsView`/`FsWriter` interface); this file is the thin CLI: parse args →
 * plan → execute (or dry-run) → print an honest report.
 */

import chalk from "chalk";
import {
	type ExecuteResult,
	executeClaudeMigration,
	planClaudeMigration,
	summarizeExecution,
} from "../core/migrate-claude.js";
import { getCaveDir, getClaudeDir, realFs } from "../core/migrate-claude-fs.js";

const SUPPORTED_SOURCES = ["claude"] as const;

interface MigrateArgs {
	help: boolean;
	dryRun: boolean;
	/** Value of `--from`, or undefined if absent. */
	from: string | undefined;
}

/** PURE arg parse (exported for tests). */
export function parseMigrateArgs(rest: string[]): MigrateArgs {
	const out: MigrateArgs = { help: false, dryRun: false, from: undefined };
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--help" || a === "-h") out.help = true;
		else if (a === "--dry-run" || a === "--dryrun") out.dryRun = true;
		else if (a === "--from") out.from = rest[++i];
		else if (a.startsWith("--from=")) out.from = a.slice("--from=".length);
	}
	return out;
}

function printHelp(): void {
	process.stdout.write(
		[
			"caveman migrate --from claude [--dry-run]",
			"",
			"Reuse an existing Claude Code setup in caveman, in one step:",
			"  • skills, agents, slash commands, settings.json, global CLAUDE.md → imported into the cave config dir",
			"  • MCP servers + per-project memory → reused automatically at runtime (no copy)",
			"",
			"Idempotent: existing cave config is never clobbered (import skips, settings merge with cave keys winning).",
			"",
			"Flags:",
			"  --from <source>   migration source (supported: claude)",
			"  --dry-run         show what WOULD be imported; write nothing",
			"  --help            this help",
		].join("\n") + "\n",
	);
}

function printResult(result: ExecuteResult): void {
	const tag = result.dryRun ? chalk.yellow("[dry-run] ") : "";
	const lines = summarizeExecution(result);
	if (lines.length === 0) {
		process.stdout.write(`${tag}Nothing to migrate — no reusable Claude Code config found.\n`);
		return;
	}
	process.stdout.write(`${tag}${result.dryRun ? "Would migrate" : "Migrated"} from ~/.claude:\n`);
	for (const line of lines) process.stdout.write(`  ${line}\n`);

	const merges = result.items.filter((i) => i.action === "merge" && i.adoptedKeys?.length);
	for (const m of merges) {
		process.stdout.write(chalk.dim(`  settings: adopted ${m.adoptedKeys?.join(", ")}\n`));
	}
	if (result.conflictsSkipped.length > 0) {
		process.stdout.write(chalk.dim(`  skipped (already present in cave): ${result.conflictsSkipped.join(", ")}\n`));
	}
	process.stdout.write(
		chalk.dim("\nNote: MCP servers + project memory are read from ~/.claude at runtime (not copied).\n"),
	);
	if (result.dryRun)
		process.stdout.write(chalk.yellow("Dry run — nothing was written. Re-run without --dry-run to apply.\n"));
}

/**
 * Handle `caveman migrate …`. Returns false if this is not a migrate invocation
 * (so the caller falls through to the next subcommand / the agent runtime).
 */
export async function handleMigrateCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "migrate") return false;

	const parsed = parseMigrateArgs(args.slice(1));
	if (parsed.help) {
		printHelp();
		return true;
	}

	const from = parsed.from ?? "claude"; // sole supported source today; default for ergonomics
	if (!SUPPORTED_SOURCES.includes(from as (typeof SUPPORTED_SOURCES)[number])) {
		process.stderr.write(
			chalk.red(`Unknown migration source: ${from}. Supported: ${SUPPORTED_SOURCES.join(", ")}.\n`),
		);
		process.exit(1);
	}

	const claudeDir = getClaudeDir();
	const plan = planClaudeMigration({ claudeDir, caveDir: getCaveDir(), fs: realFs });
	if (plan.claudeMissing) {
		process.stdout.write(`No Claude Code config found at ${claudeDir} — nothing to migrate.\n`);
		return true;
	}

	const result = executeClaudeMigration(plan, { dryRun: parsed.dryRun, fs: realFs });
	printResult(result);
	return true;
}
