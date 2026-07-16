import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CompactCommand extends InteractiveSlashCommand {
	readonly name = "compact";

	condition(text: string): boolean {
		return exactOrArg("/compact", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const entries = context.sessionManager.getEntries();
			const messageCount = entries.filter((entry) => entry.type === "message").length;

			if (messageCount < 2) {
				context.showWarning("Nothing to compact (no messages yet)");
				return;
			}

			context.stopLoadingAndClearStatus();

			try {
				await context.session.compact(arg(text, "/compact"));
			} catch {
				// Compaction errors are already emitted through the session event stream.
			}
		});
	}
}
