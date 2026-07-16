import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class BtwCommand extends InteractiveSlashCommand {
	readonly name = "btw";

	condition(text: string): boolean {
		return exactOrArg("/btw", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.btw(args(text, "/btw")));
	}
}
