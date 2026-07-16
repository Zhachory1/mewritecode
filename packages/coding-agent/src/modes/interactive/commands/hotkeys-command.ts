import { Markdown, Spacer, Text } from "@zhachory1/mewrite-tui";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class HotkeysCommand extends InteractiveSlashCommand {
	readonly name = "hotkeys";

	condition(text: string): boolean {
		return exact("/hotkeys", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		const hotkeys = context.buildHotkeysMarkdown();
		context.editor.setText("");
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new DynamicBorder());
		context.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, context.getMarkdownTheme()));
		context.chatContainer.addChild(new DynamicBorder());
		context.ui.requestRender();
	}
}
