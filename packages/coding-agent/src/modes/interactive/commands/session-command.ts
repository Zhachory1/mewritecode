import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class SessionCommand extends InteractiveSlashCommand {
	readonly name = "session";

	condition(text: string): boolean {
		return exact("/session", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.mode.session();
		context.editor.setText("");
	}
}
