import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class QueueCommand extends InteractiveSlashCommand {
	readonly name = "queue";

	condition(text: string): boolean {
		return exactOrArg("/queue", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.queue(args(text, "/queue")));
	}
}
