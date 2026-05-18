/**
 * Terminal notifications.
 *
 * Two surfaces:
 *
 *   1. `bell()` — emits a single `\x07` BEL byte. Most modern terminals also
 *      generate a desktop notification when configured to.
 *   2. `notify({title, body})` — emits OSC 9 (iTerm2/Terminal.app) and OSC 777
 *      (urxvt/notify protocol). Falls back to writing the title to stderr
 *      when the terminal does not support either.
 *
 * Reference: claude-code ink/useTerminalNotification.ts:1.
 *
 * Notes:
 *   - We do not shell out to `osascript`/`terminal-notifier`. Doing so requires
 *     macOS-specific binaries and a permission grant. OSC 9 reaches every
 *     well-behaved modern terminal (iTerm2, WezTerm, Alacritty, kitty,
 *     Terminal.app), so it's the lowest-overhead path.
 *   - OSC sequences are silently ignored by terminals that don't understand
 *     them, so emitting both is safe.
 */

import { isatty } from "node:tty";

export interface NotifyOptions {
	title?: string;
	body: string;
	/** Emit a BEL alongside the OSC notification. Default: true. */
	bell?: boolean;
}

function writeToStream(data: string): void {
	try {
		// Prefer stderr because stdout may be piped/captured.
		if (process.stderr?.writable) {
			process.stderr.write(data);
		}
	} catch {
		/* swallow — terminal write must never throw */
	}
}

/** Single bell. Returns false when stderr isn't a TTY. */
export function bell(): boolean {
	if (!process.stderr || !isatty(process.stderr.fd)) return false;
	writeToStream("\x07");
	return true;
}

/**
 * Send a desktop notification. Returns false when stderr isn't a TTY (so the
 * caller can fall back to a log line).
 */
export function notify(opts: NotifyOptions): boolean {
	if (!process.stderr || !isatty(process.stderr.fd)) {
		// Best-effort: write a single human-readable line so CI logs still
		// surface the alert text.
		writeToStream(`[notify] ${opts.title ? `${opts.title}: ` : ""}${opts.body}\n`);
		return false;
	}

	const text = opts.title ? `${opts.title}: ${opts.body}` : opts.body;
	const safe = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ").slice(0, 256);

	// OSC 9 — iTerm2 / Terminal.app / WezTerm / Alacritty.
	writeToStream(`\x1b]9;${safe}\x07`);
	// OSC 777;notify — urxvt + notify protocol.
	writeToStream(`\x1b]777;notify;${opts.title ?? "cave"};${safe}\x07`);

	if (opts.bell !== false) bell();
	return true;
}
