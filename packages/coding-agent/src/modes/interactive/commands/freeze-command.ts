import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class FreezeCommand extends InteractiveSlashCommand {
	readonly name = "freeze";

	condition(text: string): boolean {
		return exactOrArg("/freeze", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.freeze(arg(text, "/freeze")));
	}
}
