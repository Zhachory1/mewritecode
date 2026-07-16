import { AssistantMessageComponent } from "../components/assistant-message.js";
import { SettingsSelectorComponent } from "../components/settings-selector.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { AUTO_THEME_NAME, getAvailableThemes, setTheme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

function showSettingsSelector(context: InteractiveSlashCommandContext): void {
	context.showSelector((done) => {
		const contextEngineSettings = context.settingsManager.getContextEngineSettings();
		const selector = new SettingsSelectorComponent(
			{
				autoCompact: context.session.autoCompactionEnabled,
				showImages: context.settingsManager.getShowImages(),
				autoResizeImages: context.settingsManager.getImageAutoResize(),
				blockImages: context.settingsManager.getBlockImages(),
				enableSkillCommands: context.settingsManager.getEnableSkillCommands(),
				steeringMode: context.session.steeringMode,
				followUpMode: context.session.followUpMode,
				transport: context.settingsManager.getTransport(),
				thinkingLevel: context.session.thinkingLevel,
				availableThinkingLevels: context.session.getAvailableThinkingLevels(),
				currentTheme: context.settingsManager.getTheme() || AUTO_THEME_NAME,
				availableThemes: getAvailableThemes(),
				hideThinkingBlock: context.getHideThinkingBlock(),
				showChangelogOnStartup: context.settingsManager.getShowChangelogOnStartup(),
				collapseChangelog: context.settingsManager.getCollapseChangelog(),
				doubleEscapeAction: context.settingsManager.getDoubleEscapeAction(),
				treeFilterMode: context.settingsManager.getTreeFilterMode(),
				showHardwareCursor: context.settingsManager.getShowHardwareCursor(),
				editorPaddingX: context.settingsManager.getEditorPaddingX(),
				autocompleteMaxVisible: context.settingsManager.getAutocompleteMaxVisible(),
				quietStartup: context.settingsManager.getQuietStartup(),
				clearOnShrink: context.settingsManager.getClearOnShrink(),
				caveModeEnabled: context.settingsManager.getCaveModeEnabled(),
				caveModeIntensity: context.settingsManager.getCaveModeIntensity(),
				caveModeToolCompression: context.settingsManager.getCaveModeToolCompression(),
				ponytailEnabled: context.settingsManager.getPonytailEnabled(),
				ponytailIntensity: context.settingsManager.getPonytailIntensity(),
				headroomEnabled: contextEngineSettings.compression.headroom.enabled,
			},
			{
				onAutoCompactChange: (enabled) => {
					context.session.setAutoCompactionEnabled(enabled);
					context.setFooterAutoCompactEnabled(enabled);
				},
				onShowImagesChange: (enabled) => {
					context.settingsManager.setShowImages(enabled);
					for (const child of context.chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setShowImages(enabled);
						}
					}
				},
				onAutoResizeImagesChange: (enabled) => {
					context.settingsManager.setImageAutoResize(enabled);
				},
				onBlockImagesChange: (blocked) => {
					context.settingsManager.setBlockImages(blocked);
				},
				onEnableSkillCommandsChange: (enabled) => {
					context.settingsManager.setEnableSkillCommands(enabled);
					context.setupAutocomplete();
				},
				onSteeringModeChange: (mode) => {
					context.session.setSteeringMode(mode);
				},
				onFollowUpModeChange: (mode) => {
					context.session.setFollowUpMode(mode);
				},
				onTransportChange: (transport) => {
					context.settingsManager.setTransport(transport);
					context.session.agent.transport = transport;
				},
				onThinkingLevelChange: (level) => {
					context.session.setThinkingLevel(level);
					context.invalidateFooter();
					context.updateEditorBorderColor();
				},
				onThemeChange: (themeName) => {
					const result = setTheme(themeName, true);
					context.settingsManager.setTheme(themeName);
					context.ui.invalidate();
					if (!result.success) {
						context.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
					}
				},
				onThemePreview: (themeName) => {
					const result = setTheme(themeName, true);
					if (result.success) {
						context.ui.invalidate();
						context.ui.requestRender();
					}
				},
				onHideThinkingBlockChange: (hidden) => {
					context.setHideThinkingBlock(hidden);
					context.settingsManager.setHideThinkingBlock(hidden);
					for (const child of context.chatContainer.children) {
						if (child instanceof AssistantMessageComponent) {
							child.setHideThinkingBlock(hidden);
						}
					}
					context.rebuildChatFromMessages();
				},
				onShowChangelogOnStartupChange: (show) => {
					context.settingsManager.setShowChangelogOnStartup(show);
				},
				onCollapseChangelogChange: (collapsed) => {
					context.settingsManager.setCollapseChangelog(collapsed);
				},
				onQuietStartupChange: (enabled) => {
					context.settingsManager.setQuietStartup(enabled);
				},
				onDoubleEscapeActionChange: (action) => {
					context.settingsManager.setDoubleEscapeAction(action);
				},
				onTreeFilterModeChange: (mode) => {
					context.settingsManager.setTreeFilterMode(mode);
				},
				onShowHardwareCursorChange: (enabled) => {
					context.settingsManager.setShowHardwareCursor(enabled);
					context.ui.setShowHardwareCursor(enabled);
				},
				onEditorPaddingXChange: (padding) => {
					context.settingsManager.setEditorPaddingX(padding);
					context.applyEditorDisplaySettings();
				},
				onAutocompleteMaxVisibleChange: (maxVisible) => {
					context.settingsManager.setAutocompleteMaxVisible(maxVisible);
					context.applyEditorDisplaySettings();
				},
				onClearOnShrinkChange: (enabled) => {
					context.settingsManager.setClearOnShrink(enabled);
					context.ui.setClearOnShrink(enabled);
				},
				onCaveModeEnabledChange: (enabled) => {
					context.settingsManager.setCaveModeEnabled(enabled);
					if (enabled) {
						context.session.setCaveModeSessionIntensity(context.settingsManager.getCaveModeIntensity());
					} else {
						context.session.setCaveModeSessionDisabled();
					}
				},
				onCaveModeIntensityChange: (intensity) => {
					context.settingsManager.setCaveModeIntensity(intensity);
					context.session.setCaveModeSessionIntensity(intensity);
				},
				onCaveModeToolCompressionChange: (enabled) => {
					context.settingsManager.setCaveModeToolCompression(enabled);
					context.session.setCaveModeSessionToolCompression(enabled);
				},
				onPonytailEnabledChange: (enabled) => {
					context.settingsManager.setPonytailEnabled(enabled);
					if (enabled) {
						context.session.setPonytailSessionIntensity(context.settingsManager.getPonytailIntensity());
					} else {
						context.session.setPonytailSessionDisabled();
					}
				},
				onPonytailIntensityChange: (intensity) => {
					context.settingsManager.setPonytailIntensity(intensity);
					context.session.setPonytailSessionIntensity(intensity);
				},
				onHeadroomEnabledChange: (enabled) => {
					context.settingsManager.setHeadroomEnabled(enabled);
				},
				onCancel: () => {
					done();
					context.ui.requestRender();
				},
			},
		);
		return { component: selector, focus: selector.getSettingsList() };
	});
}

export class SettingsCommand extends InteractiveSlashCommand {
	readonly name = "settings";

	condition(text: string): boolean {
		return exact("/settings", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		showSettingsSelector(context);
		context.clearEditor();
	}
}
