import { Container, Text } from "@juliusbrussee/caveman-tui";
import { theme } from "../theme/theme.js";
import { keyText } from "./keybinding-hints.js";

export interface SessionPanelOptions {
	mode?: string;
	auth?: string;
	tip?: string;
}

function defaultTips(): readonly string[] {
	return [
		"/hotkeys lists every keyboard shortcut",
		"/skills opens the skill hub",
		`${keyText("app.thinking.cycle")} cycles thinking depth`,
		`${keyText("app.tools.expand")} toggles tool output expansion`,
		`${keyText("app.editor.external")} opens the message in $EDITOR`,
		`${keyText("app.message.followUp")} queues a follow-up message`,
	];
}

export class SessionPanelComponent extends Container {
	constructor(options: SessionPanelOptions = {}) {
		super();
		const lines = composeLines(options);
		for (const line of lines) {
			if (line) this.addChild(new Text(line, 1, 0));
		}
	}
}

function composeLines(options: SessionPanelOptions): string[] {
	const lines: string[] = [];
	if (options.mode) {
		lines.push(`${theme.fg("dim", "mode:")} ${theme.fg("accent", options.mode)}`);
	}
	if (options.auth) {
		lines.push(`${theme.fg("dim", "auth:")} ${theme.fg("muted", options.auth)}`);
	}
	const tip = options.tip ?? randomTip();
	if (tip) {
		lines.push(`${theme.fg("dim", "tip:")} ${theme.fg("dim", tip)}`);
	}
	return lines;
}

function randomTip(): string {
	const tips = defaultTips();
	const idx = Math.floor(Math.random() * tips.length);
	return tips[idx];
}
