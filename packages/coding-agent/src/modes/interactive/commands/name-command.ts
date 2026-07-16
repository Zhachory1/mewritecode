import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class NameCommand extends InteractiveSlashCommand {
	readonly name = "name";

	condition(text: string): boolean {
		return exactOrArg("/name", text);
	}

	handleCommand(text: string, context: InteractiveSlashCommandContext): void {
		const name = text.replace(/^\/name\s*/, "").trim();
		context.clearEditor();
		if (!name) {
			const currentName = context.sessionManager.getSessionName();
			if (currentName) {
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
			} else {
				context.showWarning("Usage: /name <name>");
			}
			context.ui.requestRender();
			return;
		}

		context.sessionManager.appendSessionInfo(name);
		context.updateTerminalTitle();
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0));
		context.ui.requestRender();
	}
}
