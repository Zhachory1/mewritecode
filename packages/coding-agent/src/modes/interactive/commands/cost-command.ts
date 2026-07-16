import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { runCostCommand } from "../../../core/slash-commands.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CostCommand extends InteractiveSlashCommand {
	readonly name = "cost";

	condition(text: string): boolean {
		return exact("/cost", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const stats = context.session.getSessionStats();
			const result = runCostCommand({
				stats: {
					inputTokens: stats.tokens.input,
					outputTokens: stats.tokens.output,
					cacheReadTokens: stats.tokens.cacheRead,
					cacheWriteTokens: stats.tokens.cacheWrite,
					dollars: stats.cost,
					pricingKnown: stats.cost > 0,
				},
			});
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(result.lines.join("\n"), 1, 0));
			context.ui.requestRender();
		});
	}
}
