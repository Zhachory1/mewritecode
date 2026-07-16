import { runPlanCommand } from "../../../core/slash-commands/plan.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class PlanCommand extends InteractiveSlashCommand {
	readonly name = "plan";

	condition(text: string): boolean {
		return exactOrArg("/plan", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const result = runPlanCommand(args(text, "/plan"), {
				getChatMode: () => context.session.chatMode,
				setChatMode: (mode) => context.session.setChatMode(mode),
				sessionId: context.session.sessionId,
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
			context.refreshChatModeFooter();
			if (result.promptToSend) {
				const prompt = result.promptToSend;
				context.editor.addToHistory?.(`/plan ${prompt}`);
				void context.session
					.prompt(prompt, context.session.isStreaming ? { streamingBehavior: "steer" } : undefined)
					.catch((err: unknown) => {
						context.showError(err instanceof Error ? err.message : String(err));
					});
			}
		});
	}
}
