import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class RecipeCommand extends InteractiveSlashCommand {
	readonly name = "recipe";

	condition(text: string): boolean {
		return exactOrArg("/recipe", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.recipe(text));
	}
}
