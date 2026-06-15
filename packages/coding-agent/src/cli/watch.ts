/**
 * WS18 — `cave watch` subcommand.
 *
 * Long-lived process that watches the repository for cave comment markers
 * and fires the agent when `// cave!` (or language-equivalent) is detected.
 *
 * Usage:
 *   cave watch [paths...]                  — watch cwd (or specified paths)
 *   cave watch --poll <ms>                 — polling fallback (network mounts)
 *   cave watch --debounce <ms>             — override debounce (default 500ms)
 *   cave watch --ext ts,py,rs             — restrict to extensions
 *   cave watch --no-session               — don't persist session
 *   cave watch --model <pattern>          — model to use for agent runs
 *   cave watch --help                     — show help
 */

import { resolve } from "node:path";
import { cwd as processCwd } from "node:process";
import chalk from "chalk";
import type { AgentRunFn } from "../core/watch-files/trigger.js";
import { DEFAULT_WATCH_EXTENSIONS, startWatcher } from "../core/watch-files/watcher.js";

interface WatchArgs {
	paths: string[];
	pollIntervalMs?: number;
	debounceMs: number;
	extensions: string[];
	model?: string;
	noSession: boolean;
	help: boolean;
}

function parseWatchArgs(args: string[]): WatchArgs {
	const out: WatchArgs = {
		paths: [],
		debounceMs: 500,
		extensions: [...DEFAULT_WATCH_EXTENSIONS],
		noSession: false,
		help: false,
	};

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--poll": {
				const ms = Number.parseInt(args[++i] ?? "", 10);
				out.pollIntervalMs = Number.isNaN(ms) ? 1000 : ms;
				break;
			}
			case "--debounce": {
				const ms = Number.parseInt(args[++i] ?? "", 10);
				if (!Number.isNaN(ms)) out.debounceMs = ms;
				break;
			}
			case "--ext": {
				const raw = args[++i] ?? "";
				out.extensions = raw
					.split(",")
					.map((s) => s.trim().replace(/^\./, "").toLowerCase())
					.filter(Boolean);
				break;
			}
			case "--model":
				out.model = args[++i];
				break;
			case "--no-session":
				out.noSession = true;
				break;
			case "--help":
			case "-h":
				out.help = true;
				break;
			default:
				if (!a.startsWith("-")) {
					out.paths.push(resolve(a));
				} else {
					process.stderr.write(chalk.yellow(`[cave watch] unknown flag: ${a}\n`));
				}
		}
	}

	if (out.paths.length === 0) {
		out.paths.push(processCwd());
	}

	return out;
}

function printHelp(): void {
	console.log(`Usage: cave watch [paths...] [options]

Watch source files for cave comment markers and dispatch the agent.

Markers (multi-language):
  // cave!  <instruction>  — fire: edit the file, remove marker on success
  // cave?  <question>     — Q&A: read-only, print response to stderr
  // cave   <context>      — accumulate context for next fire/Q&A

Equivalent in Python: # cave! / # cave? / # cave
Equivalent in Rust:   // cave! / // cave? / // cave
Block comments:       /* cave! */ works in C-style languages.

Options:
  paths...               Directories or files to watch (default: cwd)
  --poll <ms>            Enable polling fallback at <ms> interval (for NFS/FUSE)
  --debounce <ms>        Debounce delay (default 500)
  --ext <list>           Comma-separated extensions to watch (e.g. ts,py,rs)
  --model <pattern>      Model to use for agent runs
  --no-session           Don't persist agent session to disk
  -h, --help             Show this help

Examples:
  cave watch
  cave watch src/ --ext ts,py
  cave watch --poll 1000 /mnt/nfs/project
`);
}

/**
 * Build a stub agentRun that prints the prompt to stderr.
 * The real implementation would wire up the agent runtime.
 *
 * In a full wiring you'd import createAgentSessionRuntime and
 * call runPrintMode. We keep watch.ts thin and testable.
 */
function buildAgentRun(args: WatchArgs): AgentRunFn {
	return async (prompt: string, filePath: string, isReadOnly: boolean): Promise<string> => {
		// Dynamic import to avoid circular dependency at module load time
		const { runWatchAgentRun } = await import("./watch-agent-run.js");
		return runWatchAgentRun(prompt, filePath, isReadOnly, {
			model: args.model,
			noSession: args.noSession,
		});
	};
}

/**
 * Handle `cave watch` subcommand.
 * Returns true if the args match this subcommand (handled).
 */
export async function handleWatchCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "watch" && !args.includes("--watch")) {
		return false;
	}

	// Normalise: `cave watch [rest]` or `cave --watch [rest]`
	const rest = args[0] === "watch" ? args.slice(1) : args.filter((a) => a !== "--watch");
	const parsed = parseWatchArgs(rest);

	if (parsed.help) {
		printHelp();
		return true;
	}

	const pathList = parsed.paths.join(", ");
	process.stderr.write(
		chalk.cyan(`[cave watch] starting — watching: ${pathList} (debounce: ${parsed.debounceMs}ms)\n`),
	);
	process.stderr.write(chalk.dim(`[cave watch] drop // cave! comments to fire the agent — Ctrl+C to stop\n`));

	const agentRun = buildAgentRun(parsed);

	const handle = startWatcher(
		{
			paths: parsed.paths,
			debounceMs: parsed.debounceMs,
			extensions: parsed.extensions,
			pollIntervalMs: parsed.pollIntervalMs,
		},
		agentRun,
	);

	// Graceful exit on any termination signal. Previously only SIGINT was
	// handled, so SIGTERM (kill, container stop) and SIGHUP (terminal close)
	// tore the process down without calling `handle.stop()`, leaking the open
	// `fs.watch` handles. Handle all three through one shutdown path.
	let stopping = false;
	const shutdown = (signal: NodeJS.Signals) => {
		if (stopping) return;
		stopping = true;
		process.stderr.write(chalk.dim(`\n[cave watch] stopping (${signal})...\n`));
		handle.stop();
		process.exit(0);
	};
	process.once("SIGINT", () => shutdown("SIGINT"));
	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGHUP", () => shutdown("SIGHUP"));

	// Keep the process alive
	await new Promise<void>(() => {
		// Never resolves — process lives until a termination signal
		// (SIGINT / SIGTERM / SIGHUP) triggers the shutdown handlers above.
	});

	return true;
}
