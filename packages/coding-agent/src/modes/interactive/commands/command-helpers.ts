import { matchesKey } from "@zhachory1/mewrite-tui";
import type { ExtensionContext } from "../../../core/extensions/index.js";
import type { KeyId } from "../../../core/keybindings.js";
import type { InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export function stopLoadingAndClearStatus(context: InteractiveSlashCommandContext): void {
	context.loadingAnimation?.stop();
	context.statusContainer.clear();
}

export async function updateAvailableProviderCount(context: InteractiveSlashCommandContext): Promise<void> {
	let models = context.session.scopedModels.map((scoped) => scoped.model);
	if (models.length === 0) {
		try {
			models = await context.session.modelRegistry.getAvailable();
		} catch {
			models = [];
		}
	}
	context.footerDataProvider.setAvailableProviderCount(new Set(models.map((model) => model.provider)).size);
}

export function setupExtensionShortcuts(context: InteractiveSlashCommandContext): void {
	const extensionRunner = context.session.extensionRunner;
	if (!extensionRunner) return;
	const shortcuts = extensionRunner.getShortcuts(context.keybindings.getEffectiveConfig());
	if (shortcuts.size === 0) return;

	context.defaultEditor.onExtensionShortcut = (data: string) => {
		for (const [shortcutStr, shortcut] of shortcuts) {
			if (matchesKey(data, shortcutStr as KeyId)) {
				Promise.resolve(shortcut.handler(createExtensionContext(context))).catch((err) => {
					context.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
				});
				return true;
			}
		}
		return false;
	};
}

function createExtensionContext(context: InteractiveSlashCommandContext): ExtensionContext {
	const session = context.runtimeHost.session;
	return {
		ui: context.extensionUi,
		hasUI: true,
		cwd: session.sessionManager.getCwd(),
		sessionManager: session.sessionManager,
		modelRegistry: session.modelRegistry,
		model: session.model,
		isIdle: () => !session.isStreaming,
		signal: session.agent.signal,
		abort: () => session.abort(),
		hasPendingMessages: () => session.pendingMessageCount > 0,
		shutdown: () => {
			void context.shutdown();
		},
		getContextUsage: () => session.getContextUsage(),
		compact: (options) => {
			void (async () => {
				try {
					const result = await session.compact(options?.customInstructions);
					options?.onComplete?.(result);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					options?.onError?.(err);
				}
			})();
		},
		getSystemPrompt: () => session.systemPrompt,
	};
}
