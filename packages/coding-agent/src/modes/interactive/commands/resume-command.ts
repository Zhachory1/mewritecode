import { MissingSessionCwdError } from "../../../core/session-cwd.js";
import { SessionManager } from "../../../core/session-manager.js";
import { SessionSelectorComponent } from "../components/session-selector.js";
import { resolveSessionReference } from "../session-reference.js";
import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

async function resumeSession(context: InteractiveSlashCommandContext, sessionPath: string): Promise<void> {
	context.stopLoadingAndClearStatus();
	try {
		const result = await context.runtimeHost.switchSession(sessionPath);
		if (result.cancelled) return;
		await context.handleRuntimeSessionChange();
		context.renderCurrentSessionState();
		context.showStatus("Resumed session");
	} catch (error: unknown) {
		if (error instanceof MissingSessionCwdError) {
			const selectedCwd = await context.promptForMissingSessionCwd(error);
			if (!selectedCwd) {
				context.showStatus("Resume cancelled");
				return;
			}
			const result = await context.runtimeHost.switchSession(sessionPath, selectedCwd);
			if (result.cancelled) return;
			await context.handleRuntimeSessionChange();
			context.renderCurrentSessionState();
			context.showStatus("Resumed session in current cwd");
			return;
		}
		await context.handleFatalRuntimeError("Failed to resume session", error);
	}
}

async function resumeTarget(context: InteractiveSlashCommandContext, target: string): Promise<void> {
	const resolved = await resolveSessionReference(
		target,
		context.sessionManager.getCwd(),
		context.sessionManager.getSessionDir(),
	);
	switch (resolved.type) {
		case "path":
		case "local":
		case "global":
			await resumeSession(context, resolved.path);
			return;
		case "not_found":
			context.showError(`No session found matching '${resolved.arg}'`);
			return;
	}
}

function showSessionSelector(context: InteractiveSlashCommandContext): void {
	context.showSelector((done) => {
		const selector = new SessionSelectorComponent(
			(onProgress) =>
				SessionManager.list(context.sessionManager.getCwd(), context.sessionManager.getSessionDir(), onProgress),
			SessionManager.listAll,
			async (sessionPath) => {
				done();
				await resumeSession(context, sessionPath);
			},
			() => {
				done();
				context.ui.requestRender();
			},
			() => {
				void context.shutdown();
			},
			() => context.ui.requestRender(),
			{
				renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
					const next = (nextName ?? "").trim();
					if (!next) return;
					const mgr = SessionManager.open(sessionFilePath);
					mgr.appendSessionInfo(next);
				},
				showRenameHint: true,
				keybindings: context.keybindings,
			},
			context.sessionManager.getSessionFile(),
		);
		return { component: selector, focus: selector };
	});
}

export class ResumeCommand extends InteractiveSlashCommand {
	readonly name = "resume";

	condition(text: string): boolean {
		return exactOrArg("/resume", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const target = arg(text, "/resume");
			if (target) {
				await resumeTarget(context, target);
				return;
			}
			showSessionSelector(context);
		});
	}
}
