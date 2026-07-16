import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class RollbackCommand extends InteractiveSlashCommand {
	readonly name = "rollback";

	condition(text: string): boolean {
		return exactOrArg("/rollback", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.rollback(args(text, "/rollback")));
	}
}
