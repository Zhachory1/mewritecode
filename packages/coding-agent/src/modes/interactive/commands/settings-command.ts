import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class SettingsCommand extends InteractiveSlashCommand {
	readonly name = "settings";

	condition(text: string): boolean {
		return exact("/settings", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.legacy.settings();
		context.editor.setText("");
	}
}
