import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ModeCommand extends InteractiveSlashCommand {
	readonly name = "mode";

	condition(text: string): boolean {
		return exactOrArg("/mode", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode(text));
	}
}
