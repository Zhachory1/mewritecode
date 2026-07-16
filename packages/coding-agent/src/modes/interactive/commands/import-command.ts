import { MissingSessionCwdError } from "../../../core/session-cwd.js";
import {
	broadPrefix,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

async function importSession(text: string, context: InteractiveSlashCommandContext): Promise<void> {
	const parts = text.split(/\s+/);
	if (parts.length < 2 || !parts[1]) {
		context.showError("Usage: /import <path.jsonl>");
		return;
	}
	const inputPath = parts[1];

	const confirmed = await context.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
	if (!confirmed) {
		context.showStatus("Import cancelled");
		return;
	}

	try {
		context.stopLoadingAndClearStatus();
		const result = await context.runtimeHost.importFromJsonl(inputPath);
		if (result.cancelled) {
			context.showStatus("Import cancelled");
			return;
		}
		await context.handleRuntimeSessionChange();
		context.renderCurrentSessionState();
		context.showStatus(`Session imported from: ${inputPath}`);
	} catch (error: unknown) {
		if (error instanceof MissingSessionCwdError) {
			const selectedCwd = await context.promptForMissingSessionCwd(error);
			if (!selectedCwd) {
				context.showStatus("Import cancelled");
				return;
			}
			const result = await context.runtimeHost.importFromJsonl(inputPath, selectedCwd);
			if (result.cancelled) {
				context.showStatus("Import cancelled");
				return;
			}
			await context.handleRuntimeSessionChange();
			context.renderCurrentSessionState();
			context.showStatus(`Session imported from: ${inputPath}`);
			return;
		}
		await context.handleFatalRuntimeError("Failed to import session", error);
	}
}

export class ImportCommand extends InteractiveSlashCommand {
	readonly name = "import";

	condition(text: string): boolean {
		return broadPrefix("/import", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await importSession(text, context);
		context.clearEditor();
	}
}
