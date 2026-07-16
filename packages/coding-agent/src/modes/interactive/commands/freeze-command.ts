import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

const FREEZE_INSTRUCTIONS =
	"Only preserve: active task, open files, pending decisions, unresolved errors. Drop: completed work, tangents, tool call histories.";

export class FreezeCommand extends InteractiveSlashCommand {
	readonly name = "freeze";

	condition(text: string): boolean {
		return exactOrArg("/freeze", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const entries = context.sessionManager.getEntries();
			const messageCount = entries.filter((entry) => entry.type === "message").length;

			if (messageCount < 2) {
				context.showWarning("Nothing to freeze (no messages yet)");
				return;
			}

			const label = arg(text, "/freeze");
			const statsBefore = context.session.getSessionStats();
			const tokensBefore = statsBefore.tokens.total;
			const customInstructions = label ? `${FREEZE_INSTRUCTIONS} Label: ${label}` : FREEZE_INSTRUCTIONS;

			context.stopLoadingAndClearStatus();

			try {
				await context.session.compact(customInstructions);
				const statsAfter = context.session.getSessionStats();
				const tokensAfter = statsAfter.tokens.total;
				const saved = tokensBefore - tokensAfter;
				const savedPct = tokensBefore > 0 ? Math.round((saved / tokensBefore) * 100) : 0;

				context.freezeCheckpoints.push({
					label,
					tokensBefore,
					tokensAfter,
					savedAt: new Date().toISOString(),
				});

				context.chatContainer.addChild(new Spacer(1));
				const msg =
					saved > 0
						? `Mammoth frozen${label ? ` [${label}]` : ""}. Saved ${saved.toLocaleString()} tokens (-${savedPct}%).`
						: `Mammoth frozen${label ? ` [${label}]` : ""}.`;
				context.chatContainer.addChild(new Text(theme.fg("accent", msg), 1, 0));
				context.ui.requestRender();
			} catch {
				// Compaction errors are already emitted through the session event stream.
			}
		});
	}
}
