import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ApprovalCommand extends InteractiveSlashCommand {
	readonly name = "approval";

	condition(text: string): boolean {
		return exactOrArg("/approval", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.approval(args(text, "/approval")));
	}
}
