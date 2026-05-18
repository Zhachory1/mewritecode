/**
 * WS8: `/architect` slash command.
 *
 * Subcommands:
 *   /architect                       → toggle architect mode on/off
 *   /architect on                    → enable architect mode
 *   /architect off                   → disable
 *   /architect status                → show current state
 *   /architect set <key>=<value>     → set architectModel / editorModel / editorFormat
 *   /architect help                  → this text
 *
 * The actual routing change happens in the agent runtime (router.ts) when
 * the host wires `ArchitectModeRouter` in place of the default router.
 * This handler just owns the state machine + user-facing config surface.
 */

import {
	type ArchitectModeConfig,
	type ArchitectModeState,
	defaultArchitectState,
	toggleArchitectMode,
} from "../chat-modes/architect.js";
import { type EditFormatName, isValidEditFormat } from "../edit-formats/index.js";

export interface ArchitectCommandResult {
	exitCode: number;
	output: string;
	state: ArchitectModeState;
}

export interface ArchitectCommandIO {
	state?: ArchitectModeState;
}

export async function runArchitectCommand(args: string, io: ArchitectCommandIO = {}): Promise<ArchitectCommandResult> {
	const argv = args.trim().split(/\s+/).filter(Boolean);
	const sub = argv[0] ?? "toggle";
	const current = io.state ?? defaultArchitectState();

	switch (sub) {
		case "on": {
			const r = toggleArchitectMode(current, "on");
			return { exitCode: 0, output: r.message, state: r.state };
		}
		case "off": {
			const r = toggleArchitectMode(current, "off");
			return { exitCode: 0, output: r.message, state: r.state };
		}
		case "toggle":
		case "": {
			const r = toggleArchitectMode(current, "toggle");
			return { exitCode: 0, output: r.message, state: r.state };
		}
		case "status": {
			const r = toggleArchitectMode(current, "status");
			return { exitCode: 0, output: r.message, state: r.state };
		}
		case "set":
			return runSet(argv.slice(1), current);
		default:
			return { exitCode: 0, output: formatHelp(), state: current };
	}
}

function formatHelp(): string {
	return [
		"/architect — architect/editor split chat mode (WS8)",
		"",
		"Usage:",
		"  /architect                 Toggle on/off",
		"  /architect on              Enable architect mode",
		"  /architect off             Disable",
		"  /architect status          Show current config",
		"  /architect set k=v ...     Configure (architectModel, editorModel, editorFormat)",
		"",
		"In architect mode, the strong (plan) model produces a long-form plan",
		"and the cheap (edit) model translates the plan into file edits using",
		"`editor-diff` (default) or `editor-whole`. See Aider's published",
		"results for the +5–10pp pass@1 lift on architect/editor pairings.",
	].join("\n");
}

function runSet(kvs: string[], current: ArchitectModeState): ArchitectCommandResult {
	const cfg: Partial<ArchitectModeConfig> = {};
	for (const kv of kvs) {
		const eq = kv.indexOf("=");
		if (eq === -1) {
			return {
				exitCode: 1,
				output: `architect: bad arg "${kv}" — expected key=value`,
				state: current,
			};
		}
		const key = kv.slice(0, eq).trim();
		const value = kv.slice(eq + 1).trim();
		switch (key) {
			case "architectModel":
				cfg.architectModel = value;
				break;
			case "editorModel":
				cfg.editorModel = value;
				break;
			case "editorFormat":
				if (!isValidEditFormat(value)) {
					return {
						exitCode: 1,
						output: `architect: invalid editorFormat "${value}". Try: editor-diff, editor-whole.`,
						state: current,
					};
				}
				cfg.editorFormat = value as EditFormatName;
				break;
			default:
				return {
					exitCode: 1,
					output: `architect: unknown key "${key}". Try: architectModel, editorModel, editorFormat.`,
					state: current,
				};
		}
	}
	const r = toggleArchitectMode(current, "status", cfg);
	const next: ArchitectModeState = {
		enabled: current.enabled,
		config: { ...current.config, ...cfg, editorFormat: cfg.editorFormat ?? current.config.editorFormat },
	};
	return { exitCode: 0, output: `architect: updated. ${r.message}`, state: next };
}
