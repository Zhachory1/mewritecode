import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class SkillsCommand extends InteractiveSlashCommand {
	readonly name = "skills";

	condition(text: string): boolean {
		return exact("/skills", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => context.mode.skills());
	}
}
