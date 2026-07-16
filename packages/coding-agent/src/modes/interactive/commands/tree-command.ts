import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class TreeCommand extends InteractiveSlashCommand {
	readonly name = "tree";

	condition(text: string): boolean {
		return exact("/tree", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.legacy.tree();
		context.editor.setText("");
	}
}
