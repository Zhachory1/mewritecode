import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class QuitCommand extends InteractiveSlashCommand {
	readonly name = "quit";

	condition(text: string): boolean {
		return exact("/quit", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.quit());
	}
}
