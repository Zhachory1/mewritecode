import { spawn } from "node:child_process";
import { runGoalSlashCommand } from "../../../core/slash-commands/goal.js";
import { resolveCurrentCaveInvocation } from "../../../utils/cave-invocation.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class GoalCommand extends InteractiveSlashCommand {
	readonly name = "goal";

	condition(text: string): boolean {
		return exactOrArg("/goal", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const result = await runGoalSlashCommand(args(text, "/goal"), {
				cwd: context.sessionManager.getCwd(),
				spawnDriver: (id) => {
					const invocation = resolveCurrentCaveInvocation();
					const child = spawn(invocation.command, [...invocation.argsPrefix, "goal", "resume", id], {
						cwd: context.sessionManager.getCwd(),
						detached: true,
						stdio: "ignore",
					});
					child.unref();
				},
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
		});
	}
}
