import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ActivityCommand extends InteractiveSlashCommand {
	readonly name = "activity";

	condition(text: string): boolean {
		return exact("/activity", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.activity());
	}
}
