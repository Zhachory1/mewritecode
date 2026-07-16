import {
	broadPrefix,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ExportCommand extends InteractiveSlashCommand {
	readonly name = "export";

	condition(text: string): boolean {
		return broadPrefix("/export", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await context.export(text);
		context.setEditorText("");
	}
}
