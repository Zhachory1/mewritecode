import { runRecipeSlashCommand } from "../../../core/slash-commands.js";
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
		await clearAnd(context, async () => {
			const commandArgs = text.replace(/^\/recipe\s*/, "");
			const result = await runRecipeSlashCommand(commandArgs, { cwd: context.sessionManager.getCwd() });
			context.appendSlashOutput(result.output, result.exitCode !== 0);
			if (result.goal && result.exitCode === 0) {
				await context.session.prompt(result.goal);
			}
		});
	}
}
