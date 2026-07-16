import type { Component } from "@zhachory1/mewrite-tui";
import { BorderedLoader } from "../components/bordered-loader.js";
import { AUTO_THEME_NAME, setRegisteredThemes, setTheme, theme } from "../theme/theme.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

async function reloadInteractiveSession(context: InteractiveSlashCommandContext): Promise<void> {
	if (context.session.isStreaming) {
		context.showWarning("Wait for the current response to finish before reloading.");
		return;
	}
	if (context.session.isCompacting) {
		context.showWarning("Wait for compaction to finish before reloading.");
		return;
	}

	context.resetExtensionUI();

	const loader = new BorderedLoader(
		context.ui,
		theme,
		"Reloading keybindings, extensions, skills, prompts, themes...",
		{
			cancellable: false,
		},
	);
	const previousEditor = context.editor;
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();

	const dismissLoader = (editor: Component) => {
		loader.dispose();
		context.editorContainer.clear();
		context.editorContainer.addChild(editor);
		context.ui.setFocus(editor);
		context.ui.requestRender();
	};

	try {
		await context.session.reload();
		context.keybindings.reload();
		setRegisteredThemes(context.session.resourceLoader.getThemes().themes);
		context.setHideThinkingBlock(context.settingsManager.getHideThinkingBlock());
		const themeName = context.settingsManager.getTheme() || AUTO_THEME_NAME;
		const themeResult = setTheme(themeName, true);
		if (!themeResult.success) {
			context.showError(`Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`);
		}
		context.applyEditorDisplaySettings();
		context.ui.setShowHardwareCursor(context.settingsManager.getShowHardwareCursor());
		context.ui.setClearOnShrink(context.settingsManager.getClearOnShrink());
		context.setupAutocomplete();
		context.setupExtensionShortcuts();
		context.rebuildChatFromMessages();
		dismissLoader(context.editor as Component);
		context.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		const modelsJsonError = context.session.modelRegistry.getError();
		if (modelsJsonError) {
			context.showError(`models.json error: ${modelsJsonError}`);
		}
		context.showStatus("Reloaded keybindings, extensions, skills, prompts, themes");
	} catch (error) {
		dismissLoader(previousEditor as Component);
		context.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export class ReloadCommand extends InteractiveSlashCommand {
	readonly name = "reload";

	condition(text: string): boolean {
		return exact("/reload", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => reloadInteractiveSession(context));
	}
}
