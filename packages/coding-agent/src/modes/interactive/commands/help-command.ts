import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class HelpCommand extends InteractiveSlashCommand {
	readonly name = "help";

	condition(text: string): boolean {
		return exact("/help", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.help());
	}
}
