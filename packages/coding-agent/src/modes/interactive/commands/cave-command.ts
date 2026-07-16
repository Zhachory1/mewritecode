import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CaveCommand extends InteractiveSlashCommand {
	readonly name = "cave";

	condition(text: string): boolean {
		return exactOrArg("/cave", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.cave(text));
	}
}
