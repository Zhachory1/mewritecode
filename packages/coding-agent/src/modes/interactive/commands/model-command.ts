import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ModelCommand extends InteractiveSlashCommand {
	readonly name = "model";

	condition(text: string): boolean {
		return exactOrArg("/model", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.model(arg(text, "/model")));
	}
}
