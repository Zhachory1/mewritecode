import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ChangelogCommand extends InteractiveSlashCommand {
	readonly name = "changelog";

	condition(text: string): boolean {
		return exact("/changelog", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.changelog();
		context.setEditorText("");
	}
}
