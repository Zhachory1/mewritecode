import { UserMessageSelectorComponent } from "../components/user-message-selector.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class ForkCommand extends InteractiveSlashCommand {
	readonly name = "fork";

	condition(text: string): boolean {
		return exact("/fork", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		const userMessages = context.session.getUserMessagesForForking();
		if (userMessages.length === 0) {
			context.showStatus("No messages to fork from");
			context.editor.setText("");
			return;
		}

		context.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((message) => ({ id: message.entryId, text: message.text })),
				async (entryId) => {
					const result = await context.runtimeHost.fork(entryId);
					if (result.cancelled) {
						done();
						context.ui.requestRender();
						return;
					}
					await context.handleRuntimeSessionChange();
					context.renderCurrentSessionState();
					context.editor.setText(result.selectedText ?? "");
					done();
					context.showStatus("Branched to new session");
				},
				() => {
					done();
					context.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getMessageList() };
		});
		context.editor.setText("");
	}
}
