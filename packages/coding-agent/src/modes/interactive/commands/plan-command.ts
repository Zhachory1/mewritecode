import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class PlanCommand extends InteractiveSlashCommand {
	readonly name = "plan";

	condition(text: string): boolean {
		return exactOrArg("/plan", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.plan(args(text, "/plan")));
	}
}
