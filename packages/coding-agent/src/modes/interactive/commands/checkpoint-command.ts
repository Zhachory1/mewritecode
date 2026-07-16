import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CheckpointCommand extends InteractiveSlashCommand {
	readonly name = "checkpoint";

	condition(text: string): boolean {
		return exactOrArg("/checkpoint", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.checkpoint(args(text, "/checkpoint")));
	}
}
