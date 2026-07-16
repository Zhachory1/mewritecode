import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ContextSetupCommand extends InteractiveSlashCommand {
	readonly name = "context-setup";

	condition(text: string): boolean {
		return exactOrArg("/context setup", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.contextSetup(args(text, "/context setup")));
	}
}
