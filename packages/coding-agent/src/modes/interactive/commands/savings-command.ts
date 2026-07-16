import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class SavingsCommand extends InteractiveSlashCommand {
	readonly name = "savings";

	condition(text: string): boolean {
		return exactOrArg("/savings", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.savings(args(text, "/savings")));
	}
}
