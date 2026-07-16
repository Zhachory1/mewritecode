import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class MemoryCommand extends InteractiveSlashCommand {
	readonly name = "memory";

	condition(text: string): boolean {
		return exactOrArg("/memory", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.memory(text));
	}
}
