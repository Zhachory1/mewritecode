import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ArchitectCommand extends InteractiveSlashCommand {
	readonly name = "architect";

	condition(text: string): boolean {
		return exactOrArg("/architect", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.architect(args(text, "/architect")));
	}
}
