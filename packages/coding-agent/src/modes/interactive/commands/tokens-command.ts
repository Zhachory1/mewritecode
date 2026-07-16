import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { runTokensCommand } from "../../../core/slash-commands.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class TokensCommand extends InteractiveSlashCommand {
	readonly name = "tokens";

	condition(text: string): boolean {
		return exact("/tokens", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const stats = context.session.getSessionStats();
			const result = runTokensCommand({
				stats: {
					inputTokens: stats.tokens.input,
					outputTokens: stats.tokens.output,
					cacheReadTokens: stats.tokens.cacheRead,
					cacheWriteTokens: stats.tokens.cacheWrite,
					dollars: stats.cost,
				},
			});
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(result.lines.join("\n"), 1, 0));
			context.ui.requestRender();
		});
	}
}
