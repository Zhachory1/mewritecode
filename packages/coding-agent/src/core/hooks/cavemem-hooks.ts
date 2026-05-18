/**
 * Default cavemem hook stubs (WS7).
 *
 * Returns a HooksConfig block that wires the 5 cavemem lifecycle hooks into
 * cave's WS4 hook system. Users can install these by either:
 *   1. Letting `caveman init` auto-register them when `cavemem` is on $PATH, or
 *   2. Pasting the JSON block (printed by `cave hooks install-recipe cavemem`)
 *      into ~/.cave/settings.json themselves.
 *
 * Mapping (cave event → cavemem hook id):
 *   SessionStart       → cavemem hook run session-start
 *   UserPromptSubmit   → cavemem hook run user-prompt-submit
 *   PostToolUse        → cavemem hook run post-tool-use   (async / non-blocking)
 *   Stop               → cavemem hook run stop
 *   SessionEnd         → cavemem hook run session-end
 *
 * No new hook *event types* are added — we register against the existing 12
 * declared in WS4's events.ts. Cavemem's CLI handles redaction + compression
 * + write internally; cave's only job is to fire the subprocess at the right
 * moments. PostToolUse is marked async because writing on every tool call
 * must never block the agent loop.
 */

import type { HooksConfig } from "./events.js";

export interface CavememHookOptions {
	/** Path to the cavemem binary (default: "cavemem"). */
	binary?: string;
	/** Optional --ide override (default: "cave"). */
	ide?: string;
	/** Mark the PostToolUse hook async (default: true). */
	asyncPostToolUse?: boolean;
}

const DEFAULT_BINARY = "cavemem";
const DEFAULT_IDE = "cave";

/**
 * The 5 default cavemem hook stubs as a HooksConfig block. Drop into
 * `globalHooks` or `projectHooks` via SettingsManager.setGlobalHooks().
 */
export function buildDefaultCavememHooks(options: CavememHookOptions = {}): HooksConfig {
	const binary = options.binary ?? DEFAULT_BINARY;
	const ide = options.ide ?? DEFAULT_IDE;
	const asyncPostToolUse = options.asyncPostToolUse !== false;

	const cmd = (event: string) => `${binary} hook run ${event} --ide ${ide}`;

	return {
		SessionStart: [
			{
				hooks: [
					{
						type: "command",
						command: cmd("session-start"),
						timeout: 5,
						statusMessage: "cavemem session-start",
					},
				],
			},
		],
		UserPromptSubmit: [
			{
				hooks: [
					{
						type: "command",
						command: cmd("user-prompt-submit"),
						timeout: 5,
						statusMessage: "cavemem write",
					},
				],
			},
		],
		PostToolUse: [
			{
				hooks: [
					{
						type: "command",
						command: cmd("post-tool-use"),
						timeout: 5,
						async: asyncPostToolUse,
						statusMessage: "cavemem write",
					},
				],
			},
		],
		Stop: [
			{
				hooks: [
					{
						type: "command",
						command: cmd("stop"),
						timeout: 5,
						statusMessage: "cavemem stop",
					},
				],
			},
		],
		SessionEnd: [
			{
				hooks: [
					{
						type: "command",
						command: cmd("session-end"),
						timeout: 5,
						statusMessage: "cavemem session-end",
					},
				],
			},
		],
	};
}

/**
 * Pretty-printed JSON snippet users can paste into settings.json. Used by
 * /hooks install-recipe cavemem and the docs site.
 */
export function buildCavememHooksSnippet(options: CavememHookOptions = {}): string {
	return JSON.stringify({ hooks: buildDefaultCavememHooks(options) }, null, 2);
}

/**
 * Names of the 5 cave events we wire to cavemem. Used by tests + diagnostics.
 */
export const CAVEMEM_HOOK_EVENT_NAMES = [
	"SessionStart",
	"UserPromptSubmit",
	"PostToolUse",
	"Stop",
	"SessionEnd",
] as const;
