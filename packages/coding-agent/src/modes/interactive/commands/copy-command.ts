import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class CopyCommand extends InteractiveSlashCommand {
	readonly name = "copy";

	condition(text: string): boolean {
		return exact("/copy", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await context.copy();
		context.setEditorText("");
	}
}
