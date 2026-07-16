import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ActCommand extends InteractiveSlashCommand {
	readonly name = "act";

	condition(text: string): boolean {
		return exactOrArg("/act", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.act(args(text, "/act")));
	}
}
