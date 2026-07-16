import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ShareCommand extends InteractiveSlashCommand {
	readonly name = "share";

	condition(text: string): boolean {
		return exact("/share", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await context.legacy.share();
		context.clearEditor();
	}
}
