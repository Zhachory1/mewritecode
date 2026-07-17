import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class QueueCommand extends InteractiveSlashCommand {
	readonly name = "queue";

	condition(text: string): boolean {
		return exactOrArg("/queue", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const subcommand = args(text, "/queue").trim();
			if (subcommand === "clear") {
				const count = context.commandQueue.length;
				context.commandQueue.length = 0;
				context.updatePendingMessagesDisplay();
				context.appendSlashOutput(
					count === 0 ? "Queue already empty." : `Cleared ${count} queued command${count === 1 ? "" : "s"}.`,
					false,
				);
				return;
			}
			if (subcommand === "" || subcommand === "list") {
				const queue = context.commandQueue;
				if (queue.length === 0) {
					context.appendSlashOutput("Queue is empty. Chain commands with: /a /then /b.", false);
					return;
				}
				const lines = queue.map((cmd, idx) => `  ${idx + 1}. ${cmd}`);
				context.appendSlashOutput(`${queue.length} queued:\n${lines.join("\n")}`, false);
				return;
			}
			context.appendSlashOutput(`Unknown /queue subcommand: ${subcommand}. Try /queue or /queue clear.`, true);
		});
	}
}
