/**
 * #159 — `mewrite history`.
 *
 * Standalone TUI to browse persisted local JSONL sessions. On selecting a session,
 * prints the exact command to resume it. This is separate from the live daemon
 * monitor (`mewrite agents`) and from `mewrite sessions` (daemon session list).
 */

import { ProcessTerminal, setKeybindings, TUI } from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { dlog } from "../core/daemon/debug-log.js";
import { KeybindingsManager } from "../core/keybindings.js";
import { SessionManager } from "../core/session-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { SessionSelectorComponent } from "../modes/interactive/components/session-selector.js";
import { initTheme } from "../modes/interactive/theme/theme.js";

export interface HistoryArgs {
	help?: boolean;
}

function parseArgs(args: string[]): HistoryArgs {
	const out: HistoryArgs = {};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--help":
			case "-h":
				out.help = true;
				break;
			default:
				if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
		}
	}
	return out;
}

export function printHelp(): void {
	console.log(`Usage: mewrite history [options]

Browse and resume persisted local JSONL sessions. Select a session and press
enter to see the resume command.

Options:
  -h, --help      Show this help`);
}

/**
 * Format the command that resumes a specific session file. `--session <path>`
 * takes a path (unlike `--resume`, which is a boolean that opens a picker). The
 * path is double-quoted so paths containing spaces stay a single shell argument.
 * Exported as a pure helper for testing.
 */
export function formatResumeCommand(sessionPath: string): string {
	return `mewrite --session "${sessionPath}"`;
}

export async function runHistory(args: string[]): Promise<number> {
	let parsed: HistoryArgs;
	try {
		parsed = parseArgs(args);
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		printHelp();
		return 1;
	}
	if (parsed.help) {
		printHelp();
		return 0;
	}

	dlog("history", "opening session browser");

	setKeybindings(KeybindingsManager.create());
	initTheme(SettingsManager.create().getTheme());

	return new Promise<number>((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let done = false;

		const finish = (code: number): void => {
			if (done) return;
			done = true;
			ui.stop();
			resolve(code);
		};

		// Current sessions loader (sessions in current cwd)
		const currentSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
			return SessionManager.list(process.cwd(), undefined, onProgress);
		};

		// All sessions loader (sessions across all project directories)
		const allSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
			return SessionManager.listAll(onProgress);
		};

		const selector = new SessionSelectorComponent(
			currentSessionsLoader,
			allSessionsLoader,
			(sessionPath: string) => {
				dlog("history", "session selected", { path: sessionPath });
				finish(0);
				// Print the resume command after TUI has stopped
				setImmediate(() => {
					console.log(chalk.green("\nTo resume this session, run:\n"));
					console.log(chalk.bold(`  ${formatResumeCommand(sessionPath)}`));
					console.log(chalk.dim("\nOr use --continue (-c) to resume the most recent session."));
				});
			},
			() => {
				// onCancel
				finish(0);
			},
			() => {
				// onExit
				finish(0);
			},
			() => ui.requestRender(),
			{
				// No rename functionality needed for read-only history browser
				showRenameHint: false,
			},
		);

		ui.addChild(selector);
		ui.setFocus(selector);
		ui.start();
	});
}

export async function handleHistoryCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "history") return false;
	const code = await runHistory(args.slice(1));
	process.exit(code);
}
