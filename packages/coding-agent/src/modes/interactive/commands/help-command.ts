import { Markdown, Spacer, Text } from "@zhachory1/mewrite-tui";
import { BUILTIN_SLASH_COMMANDS } from "../../../core/slash-commands.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class HelpCommand extends InteractiveSlashCommand {
	readonly name = "help";

	condition(text: string): boolean {
		return exact("/help", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			let commands = `
**Commands**
| Command | Description |
|---------|-------------|
`;
			for (const command of BUILTIN_SLASH_COMMANDS.filter((command) => command.wired)) {
				commands += `| \`/${command.name}\` | ${command.description} |\n`;
			}
			commands += `\n_Your skill, project, and extension commands aren't shown above — press \`/\` to browse everything._\n`;

			const hotkeys = context.buildHotkeysMarkdown();
			const markdownTheme = context.getMarkdownTheme();
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new DynamicBorder());
			context.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Help")), 1, 0));
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Markdown(commands.trim(), 1, 1, markdownTheme));
			context.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, markdownTheme));
			context.chatContainer.addChild(new DynamicBorder());
			context.ui.requestRender();
		});
	}
}
