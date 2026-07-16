import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ForkCommand extends InteractiveSlashCommand {
	readonly name = "fork";

	condition(text: string): boolean {
		return exact("/fork", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.mode.fork();
		context.editor.setText("");
	}
}
