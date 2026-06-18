/**
 * Utilities for formatting keybinding hints in the UI.
 */

import { getKeybindings, type Keybinding, type KeyId } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";

function formatKeys(keys: KeyId[]): string {
	if (keys.length === 0) return "";
	if (keys.length === 1) return keys[0]!;
	return keys.join("/");
}

export function keyText(keybinding: Keybinding): string {
	return formatKeys(getKeybindings().getKeys(keybinding));
}

export function keyHint(keybinding: Keybinding, description: string): string {
	return theme.fg("dim", keyText(keybinding)) + theme.fg("muted", ` ${description}`);
}

export function rawKeyHint(key: string, description: string): string {
	return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}

/** Hint advertising the activity monitor overlay (bound to F2 by default). */
export function activityMonitorHint(): string {
	return keyHint("app.subagent.toggle", "activity");
}
