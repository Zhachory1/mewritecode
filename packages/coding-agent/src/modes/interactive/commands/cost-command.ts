import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CostCommand extends InteractiveSlashCommand {
	readonly name = "cost";

	condition(text: string): boolean {
		return exact("/cost", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.cost());
	}
}
