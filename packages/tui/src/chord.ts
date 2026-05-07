/**
 * Chord-aware keybinding matcher.
 *
 * A chord is a sequence of single key presses separated by ` ` in the KeyId
 * (e.g. `"ctrl+x ctrl+s"` means: press Ctrl+X, then Ctrl+S). The plain
 * single-key matcher in `keybindings.ts` does not understand chords; this
 * module adds a stateful matcher that the consumer drives one input event at
 * a time.
 *
 * Reference: claude-code keybindings/parser.ts:1 + match.ts state machine.
 *
 * Usage:
 * ```
 * const session = new ChordSession();
 * for (const data of inputStream) {
 *   const result = session.feed(data, keys);
 *   if (result.match) handle(result.match);
 * }
 * ```
 */

import type { Keybinding, KeybindingsManager } from "./keybindings.js";
import { matchesKey } from "./keys.js";

export type ChordSegment = string; // a single key id like "ctrl+x"

/** Split a chord notation into its single-press segments. */
export function parseChord(keyId: string): ChordSegment[] {
	return keyId
		.trim()
		.split(/\s+/)
		.filter((s) => s.length > 0);
}

export interface ChordResult {
	/** True when the just-fed input completes one of the supplied chords. */
	match?: { keybinding: Keybinding; key: string };
	/** True when at least one chord is still mid-sequence (consumer should suppress default handling). */
	partial: boolean;
}

interface PendingChord {
	keybinding: Keybinding;
	key: string;
	segments: ChordSegment[];
	cursor: number;
}

/**
 * Stateful chord matcher. One instance per input focus context. Call
 * `feed(data, keybindings)` once per input event; the session decides
 * whether the event advances any in-flight chord, completes one, or resets.
 */
export class ChordSession {
	private pending: PendingChord[] = [];
	private timeoutMs: number;
	private lastFedAt = 0;

	constructor(opts: { timeoutMs?: number } = {}) {
		this.timeoutMs = opts.timeoutMs ?? 1500;
	}

	/** Drop any in-flight chord state. */
	reset(): void {
		this.pending = [];
	}

	/** True while at least one chord is mid-sequence. */
	hasPartial(): boolean {
		return this.pending.length > 0;
	}

	/**
	 * Advance the matcher with one terminal-input event. Returns
	 * `{match, partial}`. `match` is set only when the input completes a
	 * chord; partial=true while the consumer should hold its default action.
	 */
	feed(data: string, manager: KeybindingsManager, candidates: Iterable<Keybinding>): ChordResult {
		const now = Date.now();
		if (this.pending.length > 0 && now - this.lastFedAt > this.timeoutMs) {
			this.pending = [];
		}
		this.lastFedAt = now;

		// First, advance any pending chords.
		const advanced: PendingChord[] = [];
		let match: ChordResult["match"];
		for (const p of this.pending) {
			const segment = p.segments[p.cursor];
			if (segment && matchesKey(data, segment as Parameters<typeof matchesKey>[1])) {
				const next = p.cursor + 1;
				if (next === p.segments.length) {
					match = { keybinding: p.keybinding, key: p.key };
				} else {
					advanced.push({ ...p, cursor: next });
				}
			}
		}

		// Seed new chord candidates if no chord was already in flight.
		if (this.pending.length === 0) {
			for (const kb of candidates) {
				for (const key of manager.getKeys(kb)) {
					const segments = parseChord(String(key));
					if (segments.length <= 1) continue; // single-key, handled elsewhere
					if (matchesKey(data, segments[0] as Parameters<typeof matchesKey>[1])) {
						if (segments.length === 1) {
							match = { keybinding: kb, key: String(key) };
						} else {
							advanced.push({ keybinding: kb, key: String(key), segments, cursor: 1 });
						}
					}
				}
			}
		}

		this.pending = match ? [] : advanced;
		return { match, partial: this.pending.length > 0 };
	}
}
