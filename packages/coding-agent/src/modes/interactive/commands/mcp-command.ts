import { runMcpSlashCommand } from "../../../core/slash-commands/mcp.js";
import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class McpCommand extends InteractiveSlashCommand {
	readonly name = "mcp";

	condition(text: string): boolean {
		return exactOrArg("/mcp", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const result = await runMcpSlashCommand(text, { cwd: context.sessionManager.getCwd() });
			context.appendSlashOutput(result.lines.join("\n"), result.errors > 0);
		});
	}
}
