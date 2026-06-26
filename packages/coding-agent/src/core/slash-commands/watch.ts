/**
 * WS18 — `/watch` slash command.
 *
 * Toggle watch mode on/off from an interactive session.
 *
 * Subcommands:
 *   /watch           — toggle watch mode (start if stopped, stop if running)
 *   /watch on        — start watching cwd
 *   /watch off       — stop watching
 *   /watch status    — show current state
 *   /watch help      — show help text
 *
 * The watcher runs in the same process as the interactive session.
 * Triggers discovered by the watcher are dispatched via the agentRun
 * callback supplied at registration time.
 */

import { APP_NAME, WATCH_FIRE_MARKER, WATCH_MARKER, WATCH_QA_MARKER } from "../../config.js";
import type { AgentRunFn } from "../watch-files/trigger.js";
import { DEFAULT_WATCH_EXTENSIONS, startWatcher, type WatcherHandle } from "../watch-files/watcher.js";

export interface WatchCommandResult {
	exitCode: number;
	output: string;
	state: WatchCommandState;
}

export interface WatchCommandState {
	active: boolean;
	cwd: string;
	extensions: string[];
}

export function defaultWatchState(cwd = process.cwd()): WatchCommandState {
	return {
		active: false,
		cwd,
		extensions: [...DEFAULT_WATCH_EXTENSIONS],
	};
}

export interface WatchCommandIO {
	state?: WatchCommandState;
	/** Handle to stop a running watcher — managed internally. */
	handle?: WatcherHandle;
	/** Agent run callback. Required when starting the watcher. */
	agentRun?: AgentRunFn;
}

export const WATCH_SLASH_COMMAND = {
	name: "watch",
	description: `Toggle watch mode: fire agent on // ${WATCH_FIRE_MARKER} comments in source files`,
} as const;

/**
 * Run the /watch command handler.
 *
 * @param args — raw argument string after "/watch"
 * @param io   — mutable I/O bag; caller must persist `io.handle` and `io.state`
 */
export async function runWatchCommand(args: string, io: WatchCommandIO = {}): Promise<WatchCommandResult> {
	const argv = args.trim().split(/\s+/).filter(Boolean);
	const sub = argv[0] ?? "toggle";
	const current = io.state ?? defaultWatchState();

	switch (sub) {
		case "on": {
			if (current.active) {
				return { exitCode: 0, output: "Watch mode is already active.", state: current };
			}
			return startWatch(current, io);
		}

		case "off": {
			if (!current.active) {
				return { exitCode: 0, output: "Watch mode is not active.", state: current };
			}
			return stopWatch(current, io);
		}

		case "toggle": {
			if (current.active) {
				return stopWatch(current, io);
			}
			return startWatch(current, io);
		}

		case "status": {
			const status = current.active
				? `Watch mode active — watching: ${current.cwd}\nExtensions: ${current.extensions.join(", ")}`
				: "Watch mode inactive.";
			return { exitCode: 0, output: status, state: current };
		}

		case "help": {
			return {
				exitCode: 0,
				output: `\
/watch [subcommand]

Subcommands:
  /watch         — toggle watch mode
  /watch on      — start watching cwd for ${WATCH_FIRE_MARKER} markers
  /watch off     — stop watching
  /watch status  — show current state
  /watch help    — this help

When active, any // ${WATCH_FIRE_MARKER} comment (or language equivalent) in a source
file triggers the agent to process the instruction. The marker is removed
on success. // ${WATCH_QA_MARKER} triggers a read-only Q&A. // ${WATCH_MARKER} accumulates context.`,
				state: current,
			};
		}

		default: {
			return {
				exitCode: 1,
				output: `Unknown subcommand: ${sub}. Run /watch help for usage.`,
				state: current,
			};
		}
	}
}

function startWatch(state: WatchCommandState, io: WatchCommandIO): WatchCommandResult {
	const agentRun: AgentRunFn = io.agentRun ?? defaultAgentRun;

	io.handle = startWatcher(
		{
			paths: [state.cwd],
			extensions: state.extensions,
		},
		agentRun,
	);

	const next: WatchCommandState = { ...state, active: true };
	io.state = next;
	return {
		exitCode: 0,
		output: `Watch mode started. Watching: ${state.cwd}\nDrop // ${WATCH_FIRE_MARKER} comments to fire the agent.`,
		state: next,
	};
}

function stopWatch(state: WatchCommandState, io: WatchCommandIO): WatchCommandResult {
	io.handle?.stop();
	io.handle = undefined;
	const next: WatchCommandState = { ...state, active: false };
	io.state = next;
	return { exitCode: 0, output: "Watch mode stopped.", state: next };
}

/** Fallback agentRun used when no real agent is wired (prints to stderr). */
const defaultAgentRun: AgentRunFn = async (_prompt, filePath, isReadOnly) => {
	process.stderr.write(
		`[${APP_NAME} /watch] ${isReadOnly ? "Q&A" : "fire"} trigger in ${filePath} — no agent wired\n`,
	);
	return "";
};
