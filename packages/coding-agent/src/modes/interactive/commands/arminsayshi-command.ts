import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ArminSaysHiCommand extends InteractiveSlashCommand {
	readonly name = "arminsayshi";

	condition(text: string): boolean {
		return exact("/arminsayshi", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.mode.arminSaysHi();
		context.editor.setText("");
	}
}
