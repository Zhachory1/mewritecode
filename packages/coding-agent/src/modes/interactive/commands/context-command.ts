import { clearAnd, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ContextCommand extends InteractiveSlashCommand {
	readonly name = "context";

	condition(text: string): boolean {
		return (
			text === "/context" ||
			text === "/context status" ||
			text === "/context memory status" ||
			text === "/context doctor"
		);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.contextStatus());
	}
}
