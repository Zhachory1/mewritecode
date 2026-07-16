import { runCheckpointCommand } from "../../../core/slash-commands/checkpoint.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CheckpointCommand extends InteractiveSlashCommand {
	readonly name = "checkpoint";

	condition(text: string): boolean {
		return exactOrArg("/checkpoint", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const result = await runCheckpointCommand(args(text, "/checkpoint"), {
				projectRoot: context.sessionManager.getCwd(),
				sessionId: context.session.sessionId ?? "interactive",
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
		});
	}
}
