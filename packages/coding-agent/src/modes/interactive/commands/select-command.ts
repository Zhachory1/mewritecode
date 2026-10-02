import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class SelectCommand extends InteractiveSlashCommand {
	readonly name = "select";

	condition(text: string): boolean {
		return exact("/select", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.clearEditor();
		const enabled = context.ui.toggleMouseSelection();
		context.showStatus(
			enabled
				? "Mouse selection enabled: drag to select text; use /select to restore mouse-wheel scrolling."
				: "Mouse-wheel scrolling restored.",
		);
	}
}
