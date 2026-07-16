import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class PonytailCommand extends InteractiveSlashCommand {
	readonly name = "ponytail";

	condition(text: string): boolean {
		return exactOrArg("/ponytail", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.ponytail(text));
	}
}
