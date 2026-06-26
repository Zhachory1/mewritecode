/**
 * WS18 — watch subcommand.
 *
 * Long-lived process that watches the repository for configured comment markers
 * and fires the agent when the fire marker is detected.
 */

import { resolve } from "node:path";
import { cwd as processCwd } from "node:process";
import chalk from "chalk";
import { APP_NAME, WATCH_FIRE_MARKER, WATCH_MARKER, WATCH_QA_MARKER } from "../config.js";
import type { AgentRunFn } from "../core/watch-files/trigger.js";
import { DEFAULT_WATCH_EXTENSIONS, startWatcher } from "../core/watch-files/watcher.js";
import { runWatchAgentRun } from "./watch-agent-run.js";

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
					process.stderr.write(chalk.yellow(`[${APP_NAME} watch] unknown flag: ${a}\n`));
				}
		}
	}

	if (out.paths.length === 0) {
		out.paths.push(processCwd());
	}

	return out;
}

function printHelp(): void {
	console.log(`Usage: ${APP_NAME} watch [paths...] [options]

Watch source files for ${WATCH_MARKER} comment markers and dispatch the agent.

Markers (multi-language):
  // ${WATCH_FIRE_MARKER}  <instruction>  — fire: edit the file, remove marker on success
  // ${WATCH_QA_MARKER}  <question>     — Q&A: read-only, print response to stderr
  // ${WATCH_MARKER}   <context>      — accumulate context for next fire/Q&A

Equivalent in Python: # ${WATCH_FIRE_MARKER} / # ${WATCH_QA_MARKER} / # ${WATCH_MARKER}
Equivalent in Rust:   // ${WATCH_FIRE_MARKER} / // ${WATCH_QA_MARKER} / // ${WATCH_MARKER}
Block comments:       /* ${WATCH_FIRE_MARKER} */ works in C-style languages.

Options:
  paths...               Directories or files to watch (default: cwd)
  --poll <ms>            Enable polling fallback at <ms> interval (for NFS/FUSE)
  --debounce <ms>        Debounce delay (default 500)
  --ext <list>           Comma-separated extensions to watch (e.g. ts,py,rs)
  --model <pattern>      Model to use for agent runs
  --no-session           Don't persist agent session to disk
  -h, --help             Show this help

Examples:
  ${APP_NAME} watch
  ${APP_NAME} watch src/ --ext ts,py
  ${APP_NAME} watch --poll 1000 /mnt/nfs/project
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
	return async (prompt: string, filePath: string, isReadOnly: boolean): Promise<string> =>
		runWatchAgentRun(prompt, filePath, isReadOnly, {
			model: args.model,
			noSession: args.noSession,
		});
}

/**
 * Handle watch subcommand.
 * Returns true if the args match this subcommand (handled).
 */
export async function handleWatchCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "watch" && !args.includes("--watch")) {
		return false;
	}

	// Normalise: `${APP_NAME} watch [rest]` or `${APP_NAME} --watch [rest]`
	const rest = args[0] === "watch" ? args.slice(1) : args.filter((a) => a !== "--watch");
	const parsed = parseWatchArgs(rest);

	if (parsed.help) {
		printHelp();
		return true;
	}

	const pathList = parsed.paths.join(", ");
	process.stderr.write(
		chalk.cyan(`[${APP_NAME} watch] starting — watching: ${pathList} (debounce: ${parsed.debounceMs}ms)\n`),
	);
	process.stderr.write(
		chalk.dim(`[${APP_NAME} watch] drop // ${WATCH_FIRE_MARKER} comments to fire the agent — Ctrl+C to stop\n`),
	);

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
		process.stderr.write(chalk.dim(`\n[${APP_NAME} watch] stopping (${signal})...\n`));
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
