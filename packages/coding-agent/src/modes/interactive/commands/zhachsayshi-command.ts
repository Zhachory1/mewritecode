import { Spacer } from "@zhachory1/mewrite-tui";
import { ArminComponent } from "../components/armin.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ZhachSaysHiCommand extends InteractiveSlashCommand {
	readonly name = "zhachsayshi";

	condition(text: string): boolean {
		return exact("/zhachsayshi", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new ArminComponent(context.ui));
		context.clearEditor();
		context.ui.requestRender();
	}
}
