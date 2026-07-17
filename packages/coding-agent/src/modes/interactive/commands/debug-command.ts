import * as fs from "node:fs";
import * as path from "node:path";
import { Spacer, Text, visibleWidth } from "@zhachory1/mewrite-tui";
import { getDebugLogPath } from "../../../config.js";
import { theme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export function renderDebugCommand(context: InteractiveSlashCommandContext, options: { clearEditor: boolean }): void {
	const width = context.ui.terminal.columns;
	const height = context.ui.terminal.rows;
	const allLines = context.ui.render(width);
	const debugLogPath = getDebugLogPath();
	const debugData = [
		`Debug output at ${new Date().toISOString()}`,
		`Terminal: ${width}x${height}`,
		`Total lines: ${allLines.length}`,
		"",
		"=== All rendered lines with visible widths ===",
		...allLines.map((line, idx) => `[${idx}] (w=${visibleWidth(line)}) ${JSON.stringify(line)}`),
		"",
		"=== Agent messages (JSONL) ===",
		...context.session.messages.map((msg) => JSON.stringify(msg)),
		"",
	].join("\n");

	fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
	fs.writeFileSync(debugLogPath, debugData);

	context.chatContainer.addChild(new Spacer(1));
	context.chatContainer.addChild(
		new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
	);
	if (options.clearEditor) context.clearEditor();
	context.ui.requestRender();
}

export class DebugCommand extends InteractiveSlashCommand {
	readonly name = "debug";

	condition(text: string): boolean {
		return exact("/debug", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		renderDebugCommand(context, { clearEditor: true });
	}
}
