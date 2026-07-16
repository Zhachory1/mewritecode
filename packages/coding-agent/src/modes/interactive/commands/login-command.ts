import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class LoginCommand extends InteractiveSlashCommand {
	readonly name = "login";

	condition(text: string): boolean {
		return exactOrArg("/login", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.login(text));
	}
}
