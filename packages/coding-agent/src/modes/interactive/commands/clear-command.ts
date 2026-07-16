import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import { stopLoadingAndClearStatus } from "./command-helpers.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

async function startNewSession(context: InteractiveSlashCommandContext): Promise<void> {
	stopLoadingAndClearStatus(context);
	if (context.commandQueue.length > 0) {
		context.commandQueue.length = 0;
		context.updatePendingMessagesDisplay();
	}
	try {
		const result = await context.runtimeHost.newSession();
		if (result.cancelled) return;
		await context.handleRuntimeSessionChange();
		context.renderCurrentSessionState();
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
		context.ui.requestRender();
	} catch (error: unknown) {
		await context.handleFatalRuntimeError("Failed to create session", error);
	}
}

export class ClearCommand extends InteractiveSlashCommand {
	readonly name = "clear";

	condition(text: string): boolean {
		return exact("/clear", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => startNewSession(context));
	}
}

export async function handleNewSessionCommand(context: InteractiveSlashCommandContext): Promise<void> {
	await clearAnd(context, () => startNewSession(context));
}
