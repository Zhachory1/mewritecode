import {
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";
import { handleCaveModeCommand } from "./mode-command.js";

export class CaveCommand extends InteractiveSlashCommand {
	readonly name = "cave";

	condition(text: string): boolean {
		return exactOrArg("/cave", text);
	}

	handleCommand(text: string, context: InteractiveSlashCommandContext): void {
		context.editor.setText("");
		handleCaveModeCommand(text, context);
	}
}
