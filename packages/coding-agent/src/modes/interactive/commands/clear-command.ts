import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ClearCommand extends InteractiveSlashCommand {
	readonly name = "clear";

	condition(text: string): boolean {
		return exact("/clear", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.clear());
	}
}
