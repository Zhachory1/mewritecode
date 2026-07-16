import { clearAnd, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ContextLearnCommand extends InteractiveSlashCommand {
	readonly name = "context-learn";

	condition(text: string): boolean {
		return text === "/context learn" || text === "/context learn --preview";
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.contextLearn());
	}
}
