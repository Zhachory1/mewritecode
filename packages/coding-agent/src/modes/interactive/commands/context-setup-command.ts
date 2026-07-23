import { formatContextSetupHelp, validateSetupDir } from "../../../core/context-setup.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ContextSetupCommand extends InteractiveSlashCommand {
	readonly name = "context-setup";

	condition(text: string): boolean {
		return exactOrArg("/context setup", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const [subcommand, ...rest] = args(text, "/context setup").split(/\s+/).filter(Boolean);
			if (!subcommand) {
				context.appendSlashOutput(formatContextSetupHelp(context.sessionManager.getCwd()), false);
				return;
			}
			if (subcommand === "skip") {
				context.settingsManager.setContextSetupSettings({
					hasSeenSetupPrompt: true,
					skippedAt: new Date().toISOString(),
				});
				context.appendSlashOutput("Context setup skipped. Run /context setup anytime.", false);
				return;
			}
			if (subcommand === "docs-dir") {
				const value = rest.join(" ");
				if (!value) {
					context.appendSlashOutput(`Usage: /context setup ${subcommand} <path>`, true);
					return;
				}
				const validated = validateSetupDir(value, context.sessionManager.getCwd());
				if (!validated.ok) {
					context.appendSlashOutput(validated.error, true);
					return;
				}
				context.settingsManager.setContextSetupSettings({ hasSeenSetupPrompt: true, mainDocsDir: validated.path });
				context.appendSlashOutput(`Saved main docs directory: ${validated.path}`, false);
				return;
			}
			context.appendSlashOutput(`Unknown /context setup subcommand: ${subcommand}. Try /context setup.`, true);
		});
	}
}
