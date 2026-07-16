import { Spacer } from "@zhachory1/mewrite-tui";
import { ArminComponent } from "../components/armin.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ArminSaysHiCommand extends InteractiveSlashCommand {
	readonly name = "arminsayshi";

	condition(text: string): boolean {
		return exact("/arminsayshi", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new ArminComponent(context.ui));
		context.editor.setText("");
		context.ui.requestRender();
	}
}
