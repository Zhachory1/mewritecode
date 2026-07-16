import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ScopedModelsCommand extends InteractiveSlashCommand {
	readonly name = "scoped-models";

	condition(text: string): boolean {
		return exact("/scoped-models", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.scopedModels());
	}
}
