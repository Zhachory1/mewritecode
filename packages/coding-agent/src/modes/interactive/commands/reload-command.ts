import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ReloadCommand extends InteractiveSlashCommand {
	readonly name = "reload";

	condition(text: string): boolean {
		return exact("/reload", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.reload());
	}
}
