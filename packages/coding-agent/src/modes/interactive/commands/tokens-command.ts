import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class TokensCommand extends InteractiveSlashCommand {
	readonly name = "tokens";

	condition(text: string): boolean {
		return exact("/tokens", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.tokens());
	}
}
