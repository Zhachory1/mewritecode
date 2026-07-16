import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ResumeCommand extends InteractiveSlashCommand {
	readonly name = "resume";

	condition(text: string): boolean {
		return exactOrArg("/resume", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.resume(arg(text, "/resume")));
	}
}
