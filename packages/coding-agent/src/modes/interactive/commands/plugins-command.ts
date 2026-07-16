import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class PluginsCommand extends InteractiveSlashCommand {
	readonly name = "plugins";

	condition(text: string): boolean {
		return exact("/plugins", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.legacy.plugins());
	}
}
