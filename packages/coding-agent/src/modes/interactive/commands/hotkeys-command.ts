import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class HotkeysCommand extends InteractiveSlashCommand {
	readonly name = "hotkeys";

	condition(text: string): boolean {
		return exact("/hotkeys", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.mode.hotkeys();
		context.editor.setText("");
	}
}
