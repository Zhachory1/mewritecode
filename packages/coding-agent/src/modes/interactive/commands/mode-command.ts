import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { COMPRESSION_MODE_NAME } from "../../../config.js";
import { theme } from "../theme/theme.js";
import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

function renderCaveStats(context: InteractiveSlashCommandContext): void {
	const state = context.session.getCaveModeSessionState();
	const stats = context.session.getSessionStats();
	const contextUsage = stats.contextUsage;

	const lines: string[] = [];
	lines.push(theme.fg("accent", `${COMPRESSION_MODE_NAME} Stats`));
	lines.push(`  Mode: ${state.enabled ? "on" : "off"}`);
	lines.push(`  Intensity: ${state.intensity}`);
	lines.push(`  Tool compression: ${context.settingsManager.getCaveModeToolCompression() ? "on" : "off"}`);
	lines.push("");
	lines.push(theme.fg("accent", "Session Tokens"));
	lines.push(`  Input: ${stats.tokens.input.toLocaleString()}`);
	lines.push(`  Output: ${stats.tokens.output.toLocaleString()}`);
	lines.push(`  Cache read: ${stats.tokens.cacheRead.toLocaleString()}`);
	lines.push(`  Cache write: ${stats.tokens.cacheWrite.toLocaleString()}`);
	lines.push(`  Total: ${stats.tokens.total.toLocaleString()}`);
	lines.push(`  Cost: $${stats.cost.toFixed(4)}`);
	if (contextUsage) {
		const pct = contextUsage.percent != null ? `${Math.round(contextUsage.percent)}%` : "unknown";
		const tokens = contextUsage.tokens != null ? contextUsage.tokens.toLocaleString() : "unknown";
		lines.push("");
		lines.push(theme.fg("accent", "Context Window"));
		lines.push(`  Used: ${tokens} / ${contextUsage.contextWindow.toLocaleString()} (${pct})`);
	}

	context.chatContainer.addChild(new Spacer(1));
	context.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
	context.ui.requestRender();
}

export class ModeCommand extends InteractiveSlashCommand {
	readonly name = "mode";

	condition(text: string): boolean {
		return exactOrArg("/mode", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => handleCaveModeCommand(text, context));
	}
}

export function handleCaveModeCommand(text: string, context: InteractiveSlashCommandContext): void {
	const commandArg = text
		.replace(/^\/(?:cave|mode)\s*/, "")
		.trim()
		.toLowerCase();

	if (!commandArg) {
		const state = context.session.getCaveModeSessionState();
		const status = state.enabled ? `on (intensity: ${state.intensity})` : "off";
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(theme.fg("muted", `${COMPRESSION_MODE_NAME}: ${status}`), 1, 0));
		context.ui.requestRender();
		return;
	}

	if (commandArg === "on") {
		context.session.setCaveModeSessionIntensity(context.settingsManager.getCaveModeIntensity());
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(theme.fg("muted", `${COMPRESSION_MODE_NAME}: on (session)`), 1, 0));
		context.ui.requestRender();
		return;
	}

	if (commandArg === "off") {
		context.session.setCaveModeSessionDisabled();
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(theme.fg("muted", `${COMPRESSION_MODE_NAME}: off (session)`), 1, 0));
		context.ui.requestRender();
		return;
	}

	if (commandArg === "lite" || commandArg === "full" || commandArg === "ultra") {
		context.session.setCaveModeSessionIntensity(commandArg);
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(
			new Text(theme.fg("muted", `${COMPRESSION_MODE_NAME}: on, intensity set to ${commandArg} (session)`), 1, 0),
		);
		context.ui.requestRender();
		return;
	}

	if (commandArg === "stats") {
		renderCaveStats(context);
		return;
	}

	context.showWarning(`/mode: unknown argument '${commandArg}'. Usage: /mode [on|off|lite|full|ultra|stats]`);
}
