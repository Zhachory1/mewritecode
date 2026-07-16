import { Markdown, Spacer, Text } from "@zhachory1/mewrite-tui";
import { getChangelogPath, parseChangelog } from "../../../utils/changelog.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ChangelogCommand extends InteractiveSlashCommand {
	readonly name = "changelog";

	condition(text: string): boolean {
		return exact("/changelog", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);
		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((entry) => entry.content)
						.join("\n\n")
				: "No changelog entries found.";

		context.clearEditor();
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new DynamicBorder());
		context.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, context.getMarkdownTheme()));
		context.chatContainer.addChild(new DynamicBorder());
		context.ui.requestRender();
	}
}
