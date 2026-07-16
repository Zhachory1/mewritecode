import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class DebugCommand extends InteractiveSlashCommand {
	readonly name = "debug";

	condition(text: string): boolean {
		return exact("/debug", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.legacy.debug();
		context.editor.setText("");
	}
}
