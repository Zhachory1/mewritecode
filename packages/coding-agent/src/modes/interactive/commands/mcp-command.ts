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
			const activeTools = context.session.getActiveToolNames();
			const result = await runMcpSlashCommand(text, {
				cwd: context.sessionManager.getCwd(),
				mcpToolsAttached: activeTools.includes("mcp_tool_search") || activeTools.includes("mcp_tool_call"),
			});
			context.appendSlashOutput(result.lines.join("\n"), result.errors > 0);
		});
	}
}
