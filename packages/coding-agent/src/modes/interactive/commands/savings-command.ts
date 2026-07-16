import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { getAllTimeSavingsBytes, getThisWeekSavingsBytes, readCostTotals } from "../../../core/cost-persistence.js";
import { formatSavingsReport, formatSavingsShare, runSavingsCommand } from "../../../core/slash-commands/savings.js";
import { copyToClipboard } from "../../../utils/clipboard.js";
import {
	args,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class SavingsCommand extends InteractiveSlashCommand {
	readonly name = "savings";

	condition(text: string): boolean {
		return exactOrArg("/savings", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		context.editor.setText("");
		const commandArg = args(text, "/savings");
		const totals = context.session.getSavings();

		if (commandArg === "--report" || commandArg === "report") {
			const defaultAssumedRatePerMTok = 3;
			const modelRate = context.session.model?.cost?.input ?? 0;
			const assumedRatePerMTok = modelRate > 0 ? modelRate : defaultAssumedRatePerMTok;
			const file = readCostTotals();
			const reportLines = formatSavingsReport(file.savings, { assumedRatePerMTok });
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(reportLines.join("\n"), 1, 0));
			context.ui.requestRender();
			return;
		}

		if (commandArg === "--share") {
			const share = formatSavingsShare(totals);
			let copied = false;
			try {
				await copyToClipboard(share);
				copied = true;
			} catch {
				copied = false;
			}
			context.chatContainer.addChild(new Spacer(1));
			context.chatContainer.addChild(new Text(`${share}${copied ? "\n(copied to clipboard)" : ""}`, 1, 0));
			context.ui.requestRender();
			return;
		}

		const pricingKnown = (context.session.model?.cost?.input ?? 0) > 0;
		const result = runSavingsCommand({
			totals,
			pricingKnown,
			cumulativeWeekBytes: getThisWeekSavingsBytes(),
			cumulativeAllTimeBytes: getAllTimeSavingsBytes(),
		});
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(result.lines.join("\n"), 1, 0));
		context.ui.requestRender();
	}
}
