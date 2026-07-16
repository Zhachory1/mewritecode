import { copyToClipboard } from "../../../utils/clipboard.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class CopyCommand extends InteractiveSlashCommand {
	readonly name = "copy";

	condition(text: string): boolean {
		return exact("/copy", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.editor.setText("");
		const text = context.session.getLastAssistantText();
		if (!text) {
			context.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			context.showStatus("Copied last agent message to clipboard");
		} catch (error) {
			context.showError(error instanceof Error ? error.message : String(error));
		}
	}
}
