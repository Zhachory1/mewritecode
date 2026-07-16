import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class HooksCommand extends InteractiveSlashCommand {
	readonly name = "hooks";

	condition(text: string): boolean {
		return exactOrArg("/hooks", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.hooks(args(text, "/hooks")));
	}
}
