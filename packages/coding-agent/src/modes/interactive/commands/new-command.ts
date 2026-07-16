import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class NewCommand extends InteractiveSlashCommand {
	readonly name = "new";

	condition(text: string): boolean {
		return exact("/new", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.newSession());
	}
}
