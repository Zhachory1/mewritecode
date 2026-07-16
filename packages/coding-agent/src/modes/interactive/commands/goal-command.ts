import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class GoalCommand extends InteractiveSlashCommand {
	readonly name = "goal";

	condition(text: string): boolean {
		return exactOrArg("/goal", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.goal(args(text, "/goal")));
	}
}
