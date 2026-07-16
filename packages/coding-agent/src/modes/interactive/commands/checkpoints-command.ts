import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CheckpointsCommand extends InteractiveSlashCommand {
	readonly name = "checkpoints";

	condition(text: string): boolean {
		return exact("/checkpoints", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.checkpoints());
	}
}
