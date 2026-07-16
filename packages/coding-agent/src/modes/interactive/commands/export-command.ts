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
		const parts = text.split(/\s+/);
		const outputPath = parts.length > 1 ? parts[1] : undefined;
		try {
			if (outputPath?.endsWith(".jsonl")) {
				const filePath = context.session.exportToJsonl(outputPath);
				context.showStatus(`Session exported to: ${filePath}`);
			} else {
				const filePath = await context.session.exportToHtml(outputPath);
				context.showStatus(`Session exported to: ${filePath}`);
			}
		} catch (error: unknown) {
			context.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
		context.editor.setText("");
	}
}
