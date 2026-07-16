import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class BtwCommand extends InteractiveSlashCommand {
	readonly name = "btw";

	condition(text: string): boolean {
		return exactOrArg("/btw", text);
	}

	handleCommand(text: string, context: InteractiveSlashCommandContext): void {
		void clearAnd(context, () => {
			const question = args(text, "/btw").trim();
			if (!question) {
				context.showError("/btw needs a question. Usage: /btw <question>.");
				return;
			}

			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(theme.fg("dim", `↪ btw: ${question}`), 1, 0));
			const pending = new Text(theme.fg("dim", "↪ btw: (thinking…)"), 1, 0);
			context.chatContainer.addChild(pending);
			context.ui.requestRender();

			void context.session
				.askSidecar(question)
				.then((answer) => {
					pending.setText(theme.fg("dim", `↪ btw: ${answer || "(empty response)"}`));
				})
				.catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					pending.setText(theme.fg("warning", `↪ btw: error — ${msg}`));
				})
				.finally(() => context.ui.requestRender());
		});
	}
}
