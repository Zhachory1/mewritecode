import { runMemorySlashCommand } from "../../../core/slash-commands.js";
import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class MemoryCommand extends InteractiveSlashCommand {
	readonly name = "memory";

	condition(text: string): boolean {
		return exactOrArg("/memory", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			try {
				const provider = await context.session.memoryProvider();
				if (!provider) {
					context.appendSlashOutput(
						"Memory backend unavailable. Run `/memory status` to inspect configuration.",
						true,
					);
					return;
				}
				const result = await runMemorySlashCommand(text, {
					cwd: context.sessionManager.getCwd(),
					provider,
					enabled: context.session.memoryEnabled,
					settings: context.settingsManager.getMemorySettings(),
					setEnabled: (next) => context.session.setMemoryEnabled(next),
				});
				context.appendSlashOutput(result.lines.join("\n"), result.errors > 0);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				context.appendSlashOutput(
					`Memory unavailable: ${message}\nRun \`/memory status\` for setup details.`,
					true,
				);
			}
		});
	}
}
