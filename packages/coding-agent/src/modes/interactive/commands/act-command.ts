import { runActCommand } from "../../../core/slash-commands/act.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ActCommand extends InteractiveSlashCommand {
	readonly name = "act";

	condition(text: string): boolean {
		return exactOrArg("/act", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const result = runActCommand(args(text, "/act"), {
				setChatMode: (mode) => context.session.setChatMode(mode),
				sessionId: context.session.sessionId,
				enqueueFollowUp: (prompt) => {
					void context.session.prompt(prompt, { streamingBehavior: "followUp" });
				},
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
			context.refreshChatModeFooter();
		});
	}
}
