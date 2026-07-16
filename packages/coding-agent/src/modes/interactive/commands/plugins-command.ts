import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";
import { showSkillsCommand } from "./skills-command.js";

export class PluginsCommand extends InteractiveSlashCommand {
	readonly name = "plugins";

	condition(text: string): boolean {
		return exact("/plugins", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.clearEditor();
		showSkillsCommand(context, "marketplace");
	}
}
