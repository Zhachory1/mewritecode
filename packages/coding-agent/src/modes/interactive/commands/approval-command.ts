import { runApprovalCommand } from "../../../core/slash-commands/approval.js";
import {
	args,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ApprovalCommand extends InteractiveSlashCommand {
	readonly name = "approval";

	condition(text: string): boolean {
		return exactOrArg("/approval", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const result = runApprovalCommand(args(text, "/approval"), {
				getApprovalMode: () => context.session.approvalMode,
				setApprovalMode: (enabled) => context.session.setApprovalMode(enabled),
			});
			context.appendSlashOutput(result.output, result.exitCode !== 0);
			context.refreshApprovalFooter();
		});
	}
}
