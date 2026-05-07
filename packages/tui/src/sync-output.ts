/**
 * DEC private mode 2026 — Synchronized Output.
 *
 * Wraps a render frame in `\e[?2026h` (begin) and `\e[?2026l` (end) so the
 * terminal commits the entire frame atomically. Eliminates intra-frame flicker
 * (interleaved redraws) on terminals that support the sequence: kitty, iTerm2,
 * WezTerm, foot, alacritty (>=0.13), Ghostty, Windows Terminal (>=1.18),
 * Konsole, contour, mintty, recent xterm. Terminals that do not understand
 * the sequence ignore it and the output renders normally — i.e. emitting it
 * is safe everywhere, but we still gate on capability detection because:
 *
 *   1. Some legacy terminals print the literal sequence as text (broken
 *      private-mode handling).
 *   2. Multiplexers (tmux <3.4) need passthrough to be enabled or the
 *      sequence is silently dropped, leaving rendering unchanged but adding
 *      bytes to the output. We disable in those environments by default.
 *   3. SSH+screen sessions sometimes lie via TERM=xterm-256color; the
 *      classification in `terminal-detect.ts` lets us be conservative.
 */
import type { TerminalIdentity } from "./terminal-detect.js";

export const SYNC_OUTPUT_BEGIN = "\x1b[?2026h";
export const SYNC_OUTPUT_END = "\x1b[?2026l";

export type SyncOutputSupport = "supported" | "unsupported" | "unknown";

/**
 * Inputs required to classify whether the current terminal honors DEC 2026.
 *
 * We accept a `TerminalIdentity` rather than re-reading the env so the same
 * probe result drives every consumer (TUI, status line, diff view).
 */
export interface SyncOutputCapabilityInput {
	identity: TerminalIdentity;
	/** Override knob — set CAVE_SYNC_OUTPUT=on|off|auto. Default: auto. */
	override?: "on" | "off" | "auto";
}

/**
 * Classify DEC 2026 support from a probed terminal identity.
 *
 * Conservative: we return `unsupported` when the identity is unknown rather
 * than emitting bytes that may print as literal text. The override `on`
 * forces emission (useful when running under a wrapper that strips the
 * TERM_PROGRAM env). The override `off` disables emission unconditionally.
 */
export function classifySyncOutputSupport(input: SyncOutputCapabilityInput): SyncOutputSupport {
	const override = input.override ?? "auto";
	if (override === "on") return "supported";
	if (override === "off") return "unsupported";

	const { identity } = input;

	// Multiplexers need explicit passthrough; treat as unknown unless an
	// inner-host hint says otherwise. Modern tmux (>=3.4) advertises
	// passthrough but we cannot detect that from env alone, so be safe.
	if (identity.multiplexer === "tmux" || identity.multiplexer === "screen") {
		// Allow if the host program is known-supporting AND user opts in via env.
		if (process.env.CAVE_SYNC_OUTPUT_MULTIPLEXER === "1" && identity.hostProgram) {
			return classifyByProgram(identity.hostProgram);
		}
		return "unsupported";
	}

	return classifyByProgram(identity.program);
}

function classifyByProgram(program: TerminalIdentity["program"]): SyncOutputSupport {
	switch (program) {
		case "kitty":
		case "iterm2":
		case "wezterm":
		case "alacritty":
		case "ghostty":
		case "windows-terminal":
		case "vscode":
			return "supported";
		case "vte": // GNOME Terminal/Tilix — VTE >= 0.71. Cannot version-check from env. Conservative on.
			return "supported";
		case "apple-terminal":
		case "linux-console":
			return "unsupported";
		case "tmux":
		case "screen":
			return "unsupported";
		case "cmux":
		case "unknown":
			return "unknown";
		default:
			return "unknown";
	}
}

/**
 * Wrap a buffer in DEC 2026 begin/end markers when supported.
 *
 * On `unsupported`/`unknown`, returns the buffer unchanged. The caller
 * should still call `wrap` and not branch — this is the cheap path.
 */
export function wrapSyncOutput(buffer: string, support: SyncOutputSupport): string {
	if (support !== "supported") return buffer;
	return `${SYNC_OUTPUT_BEGIN}${buffer}${SYNC_OUTPUT_END}`;
}

/**
 * Standalone emit helper for renderers that build their buffer in two steps
 * (e.g. a status-line redraw that wants begin → write → end without holding
 * the whole frame in memory).
 */
export function emitSyncOutputBegin(write: (s: string) => void, support: SyncOutputSupport): void {
	if (support === "supported") write(SYNC_OUTPUT_BEGIN);
}

export function emitSyncOutputEnd(write: (s: string) => void, support: SyncOutputSupport): void {
	if (support === "supported") write(SYNC_OUTPUT_END);
}
