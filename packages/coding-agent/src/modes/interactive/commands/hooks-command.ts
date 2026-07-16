import { runHooksCommand } from "../../../core/slash-commands.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class HooksCommand extends InteractiveSlashCommand {
	readonly name = "hooks";

	condition(text: string): boolean {
		return exactOrArg("/hooks", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const result = await runHooksCommand(args(text, "/hooks"), {
				settings: context.settingsManager,
				cwd: context.sessionManager.getCwd(),
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
		});
	}
}
