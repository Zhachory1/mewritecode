import {
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class NameCommand extends InteractiveSlashCommand {
	readonly name = "name";

	condition(text: string): boolean {
		return exactOrArg("/name", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.legacy.name(text);
		context.editor.setText("");
	}
}
