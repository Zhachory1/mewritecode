import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CompactCommand extends InteractiveSlashCommand {
	readonly name = "compact";

	condition(text: string): boolean {
		return exactOrArg("/compact", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.compact(arg(text, "/compact")));
	}
}
