import { runRepomapCommand } from "../../../core/slash-commands.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class RepomapCommand extends InteractiveSlashCommand {
	readonly name = "repomap";

	condition(text: string): boolean {
		return exactOrArg("/repomap", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const result = await runRepomapCommand(args(text, "/repomap"), {
				cwd: context.sessionManager.getCwd(),
				chatState: context.repomapChatState,
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
		});
	}
}
