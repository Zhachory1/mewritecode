import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class RepomapCommand extends InteractiveSlashCommand {
	readonly name = "repomap";

	condition(text: string): boolean {
		return exactOrArg("/repomap", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.repomap(args(text, "/repomap")));
	}
}
