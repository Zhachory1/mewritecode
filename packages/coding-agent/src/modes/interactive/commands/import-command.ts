import {
	broadPrefix,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ImportCommand extends InteractiveSlashCommand {
	readonly name = "import";

	condition(text: string): boolean {
		return broadPrefix("/import", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await context.legacy.import(text);
		context.clearEditor();
	}
}
