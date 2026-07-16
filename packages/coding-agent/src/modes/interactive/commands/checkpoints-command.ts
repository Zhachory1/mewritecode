import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class CheckpointsCommand extends InteractiveSlashCommand {
	readonly name = "checkpoints";

	condition(text: string): boolean {
		return exact("/checkpoints", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			if (context.freezeCheckpoints.length === 0) {
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(
					new Text(theme.fg("muted", "No freeze checkpoints yet. Use /freeze to create one."), 1, 0),
				);
				context.ui.requestRender();
				return;
			}

			const lines: string[] = [theme.fg("accent", "Freeze Checkpoints")];
			for (let i = 0; i < context.freezeCheckpoints.length; i++) {
				const cp = context.freezeCheckpoints[i]!;
				const saved = cp.tokensBefore - cp.tokensAfter;
				const pct = cp.tokensBefore > 0 ? Math.round((saved / cp.tokensBefore) * 100) : 0;
				const labelStr = cp.label ? ` [${cp.label}]` : "";
				const timeStr = new Date(cp.savedAt).toLocaleTimeString();
				lines.push(`  #${i + 1}${labelStr}  ${timeStr}  ${saved.toLocaleString()} tokens saved (-${pct}%)`);
			}

			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
			context.ui.requestRender();
		});
	}
}
