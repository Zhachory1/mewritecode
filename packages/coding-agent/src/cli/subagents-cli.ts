/**
 * `caveman subagents …` — bidirectional install + listing for the bundled
 * subagent extension's agents (#59 stage 3).
 *
 * The runtime side (stage 2) handles auto-discovery from `~/.claude/agents/`
 * via the `CAVE_CROSS_PLATFORM_AGENTS=true` env var. This CLI is the explicit
 * alternative for users who prefer copyable, transparent semantics:
 *
 *   caveman subagents list                          — print discovered agents
 *   caveman subagents install --from claude [--dry-run]
 *                                                   — copy ~/.claude/agents/*.md
 *                                                     into ~/.cave/agent/agents/
 *   caveman subagents install --to claude [--dry-run]
 *                                                   — copy cave-bundled agents
 *                                                     into ~/.claude/agents/
 *   caveman subagents --help                        — usage
 *
 * Copies, not symlinks: a symlink tying two config dirs together is surprising
 * and breaks when the source tool is uninstalled or moves. Copy is explicit;
 * the user knows exactly what's on disk.
 *
 * Conflict policy: skip with a notice. There is no `--force` to avoid
 * accidentally clobbering personas the user has edited.
 *
 * Tool-name aliasing happens at LOAD time (see `tool-name-check.ts`
 * `CC_TOOL_ALIASES`). Copies preserve the original frontmatter on disk so the
 * file remains a valid CC persona too.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { getAgentDir, getPackageDir } from "../config.js";
import { loadAgentDefs } from "../core/agent-defs/loader.js";

interface SubagentsArgs {
	help: boolean;
	subcommand: "list" | "install" | undefined;
	from: "claude" | undefined;
	to: "claude" | undefined;
	dryRun: boolean;
}

const SUPPORTED_PLATFORMS = ["claude"] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

/** Pure arg parser (exported for tests). */
export function parseSubagentsArgs(rest: string[]): SubagentsArgs {
	const out: SubagentsArgs = {
		help: false,
		subcommand: undefined,
		from: undefined,
		to: undefined,
		dryRun: false,
	};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--help" || a === "-h") out.help = true;
		else if (a === "--dry-run" || a === "--dryrun") out.dryRun = true;
		else if (a === "list" && !out.subcommand) out.subcommand = "list";
		else if (a === "install" && !out.subcommand) out.subcommand = "install";
		else if (a === "--from") {
			const v = rest[++i];
			if (isSupportedPlatform(v)) out.from = v;
		} else if (a.startsWith("--from=")) {
			const v = a.slice("--from=".length);
			if (isSupportedPlatform(v)) out.from = v;
		} else if (a === "--to") {
			const v = rest[++i];
			if (isSupportedPlatform(v)) out.to = v;
		} else if (a.startsWith("--to=")) {
			const v = a.slice("--to=".length);
			if (isSupportedPlatform(v)) out.to = v;
		}
	}
	return out;
}

function isSupportedPlatform(v: string | undefined): v is SupportedPlatform {
	return v !== undefined && (SUPPORTED_PLATFORMS as readonly string[]).includes(v);
}

function printHelp(): void {
	process.stdout.write(
		`${[
			"caveman subagents <subcommand> [flags]",
			"",
			"Explicit, bidirectional install for the bundled subagent extension's agents.",
			"",
			"Subcommands:",
			"  list                       Print discovered agents (cave + bundled + cross-platform if enabled).",
			"  install --from claude      Copy ~/.claude/agents/*.md → ~/.cave/agent/agents/.",
			"  install --to claude        Copy cave-bundled agents → ~/.claude/agents/.",
			"",
			"Flags:",
			"  --dry-run                  Show what WOULD be copied; write nothing.",
			"  --help, -h                 This help.",
			"",
			"Notes:",
			"  - Copies, not symlinks. Re-runs skip files already present at the destination.",
			"  - Tool-name aliasing happens at LOAD time, not at install. Files are copied",
			"    verbatim; the original frontmatter stays intact so the file remains a",
			"    valid Claude Code persona.",
			"  - For runtime auto-discovery without copying, set",
			"    CAVE_CROSS_PLATFORM_AGENTS=true (see #59 stage 2).",
		].join("\n")}\n`,
	);
}

interface InstallReport {
	source: string;
	destination: string;
	copied: string[];
	skipped: Array<{ name: string; reason: "exists" | "not-a-file" }>;
	dryRun: boolean;
}

/** Pure copy planner + executor (exported for tests). */
export function copyAgentDir(source: string, destination: string, options: { dryRun?: boolean } = {}): InstallReport {
	const dryRun = options.dryRun ?? false;
	const report: InstallReport = {
		source,
		destination,
		copied: [],
		skipped: [],
		dryRun,
	};

	if (!existsSync(source)) {
		return report;
	}

	if (!dryRun) {
		mkdirSync(destination, { recursive: true });
	}

	let entries: string[];
	try {
		entries = readdirSync(source);
	} catch {
		return report;
	}

	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		const srcPath = join(source, name);
		let isFile = false;
		try {
			isFile = statSync(srcPath).isFile();
		} catch {
			continue;
		}
		if (!isFile) {
			report.skipped.push({ name, reason: "not-a-file" });
			continue;
		}
		const dstPath = join(destination, name);
		if (existsSync(dstPath)) {
			report.skipped.push({ name, reason: "exists" });
			continue;
		}
		if (!dryRun) {
			copyFileSync(srcPath, dstPath);
		}
		report.copied.push(name);
	}

	return report;
}

function printInstallReport(report: InstallReport, direction: "from" | "to"): void {
	const tag = report.dryRun ? chalk.yellow("[dry-run] ") : "";
	const arrow = direction === "from" ? "←" : "→";
	const verb = report.dryRun ? "Would copy" : "Copied";
	process.stdout.write(
		`${tag}${verb} ${report.copied.length} agent${report.copied.length === 1 ? "" : "s"} ${arrow} ${report.destination}\n`,
	);
	process.stdout.write(`  source: ${report.source}\n`);
	if (report.copied.length > 0) {
		for (const name of report.copied) {
			process.stdout.write(`  ${chalk.green("+")} ${name}\n`);
		}
	}
	if (report.skipped.length > 0) {
		const exists = report.skipped.filter((s) => s.reason === "exists");
		if (exists.length > 0) {
			process.stdout.write(
				chalk.dim(`  skipped (already present at destination): ${exists.map((s) => s.name).join(", ")}\n`),
			);
		}
	}
	if (report.copied.length === 0 && report.skipped.length === 0) {
		process.stdout.write(chalk.dim(`  (no agent files at source)\n`));
	}
	if (report.dryRun) {
		process.stdout.write(chalk.yellow("Dry run — nothing written. Re-run without --dry-run to apply.\n"));
	}
}

function getClaudeAgentsDir(home: string = homedir()): string {
	return join(home, ".claude", "agents");
}

function handleListSubcommand(): void {
	// Always include cross-platform paths in the LIST output regardless of the
	// env var — `list` is informational; the user wants to see what's available,
	// not a runtime-gated subset. Use the loader option directly.
	const result = loadAgentDefs({ crossPlatformDiscovery: true });
	if (result.agents.length === 0) {
		process.stdout.write("(no agents discovered)\n");
		return;
	}
	const rows = result.agents.map((a) => ({
		name: a.def.name,
		source: a.def.source,
		path: a.sourceInfo.path,
		description: a.def.description,
	}));
	const widestName = Math.max(...rows.map((r) => r.name.length));
	const widestSource = Math.max(...rows.map((r) => r.source.length));
	process.stdout.write(`Discovered ${rows.length} agent${rows.length === 1 ? "" : "s"}:\n\n`);
	for (const r of rows) {
		const name = r.name.padEnd(widestName);
		const source = r.source.padEnd(widestSource);
		process.stdout.write(`  ${name}  ${chalk.dim(source)}  ${r.description}\n`);
		process.stdout.write(`  ${" ".repeat(widestName)}  ${chalk.dim(`${" ".repeat(widestSource)}  ${r.path}`)}\n`);
	}
}

function handleInstallSubcommand(args: SubagentsArgs): void {
	if (args.from === undefined && args.to === undefined) {
		process.stderr.write(chalk.red("`subagents install` requires either --from <platform> or --to <platform>.\n"));
		process.stderr.write(`Supported platforms: ${SUPPORTED_PLATFORMS.join(", ")}.\n`);
		process.exit(1);
	}
	if (args.from !== undefined && args.to !== undefined) {
		process.stderr.write(chalk.red("`subagents install` accepts --from OR --to, not both.\n"));
		process.exit(1);
	}

	if (args.from === "claude") {
		const source = getClaudeAgentsDir();
		const destination = join(getAgentDir(), "agents");
		const report = copyAgentDir(source, destination, { dryRun: args.dryRun });
		printInstallReport(report, "from");
		return;
	}

	if (args.to === "claude") {
		const source = join(getPackageDir(), "agents");
		const destination = getClaudeAgentsDir();
		const report = copyAgentDir(source, destination, { dryRun: args.dryRun });
		printInstallReport(report, "to");
		return;
	}
}

/**
 * Handle `caveman subagents …`. Returns false if this is not a subagents
 * invocation (so the caller falls through to the next subcommand).
 */
export async function handleSubagentsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "subagents") return false;

	const parsed = parseSubagentsArgs(args.slice(1));
	if (parsed.help || parsed.subcommand === undefined) {
		printHelp();
		return true;
	}

	if (parsed.subcommand === "list") {
		handleListSubcommand();
		return true;
	}

	if (parsed.subcommand === "install") {
		handleInstallSubcommand(parsed);
		return true;
	}

	// Unreachable given the parser.
	printHelp();
	return true;
}

// Test export for resolve-path tests.
export { getClaudeAgentsDir };
// re-export used path resolver for test injection.
export const _internals = { resolve };
