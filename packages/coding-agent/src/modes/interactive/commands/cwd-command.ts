import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

/**
 * `/cwd <path>` (alias `/cd`) changes the running session's working directory
 * (#182). With no argument it prints the current cwd. The path may be absolute,
 * relative to the current cwd, or start with `~`. Subsequent tool calls, git
 * status, repomap, and memory recall operate against the new directory.
 */
export class CwdCommand extends InteractiveSlashCommand {
	readonly name = "cwd";

	condition(text: string): boolean {
		return exactOrArg("/cwd", text) || exactOrArg("/cd", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		const target = text.replace(/^\/(cwd|cd)\s*/, "").trim();
		context.clearEditor();

		if (!target) {
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(theme.fg("dim", `cwd: ${context.session.cwd}`), 1, 0));
			context.ui.requestRender();
			return;
		}

		try {
			const resolved = await context.session.setCwd(target);
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(theme.fg("dim", `cwd changed to: ${resolved}`), 1, 0));
		} catch (err) {
			context.showWarning(err instanceof Error ? err.message : String(err));
		}
		context.ui.requestRender();
	}
}
