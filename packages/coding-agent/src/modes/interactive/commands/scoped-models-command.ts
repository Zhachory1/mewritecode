import { resolveModelScope } from "../../../core/model-resolver.js";
import { ScopedModelsSelectorComponent } from "../components/scoped-models-selector.js";
import { updateAvailableProviderCount } from "./command-helpers.js";
import {
	clearAnd,
	exact,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class ScopedModelsCommand extends InteractiveSlashCommand {
	readonly name = "scoped-models";

	condition(text: string): boolean {
		return exact("/scoped-models", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			context.session.modelRegistry.refresh();
			const allModels = context.session.modelRegistry.getAvailable();
			if (allModels.length === 0) {
				context.showStatus("No models available");
				return;
			}

			const enabledModelIds = new Set<string>();
			let hasFilter = false;
			if (context.session.scopedModels.length > 0) {
				for (const scoped of context.session.scopedModels) {
					enabledModelIds.add(`${scoped.model.provider}/${scoped.model.id}`);
				}
				hasFilter = true;
			} else {
				const patterns = context.settingsManager.getEnabledModels();
				if (patterns !== undefined && patterns.length > 0) {
					hasFilter = true;
					const scopedModels = await resolveModelScope(patterns, context.session.modelRegistry);
					for (const scoped of scopedModels) {
						enabledModelIds.add(`${scoped.model.provider}/${scoped.model.id}`);
					}
				}
			}

			const currentEnabledIds = new Set(enabledModelIds);
			let currentHasFilter = hasFilter;
			const updateSessionModels = async (enabledIds: Set<string>) => {
				if (enabledIds.size > 0 && enabledIds.size < allModels.length) {
					const newScopedModels = await resolveModelScope(Array.from(enabledIds), context.session.modelRegistry);
					context.session.setScopedModels(
						newScopedModels.map((scoped) => ({ model: scoped.model, thinkingLevel: scoped.thinkingLevel })),
					);
				} else {
					context.session.setScopedModels([]);
				}
				await updateAvailableProviderCount(context);
				context.ui.requestRender();
			};

			context.showSelector((done) => {
				const selector = new ScopedModelsSelectorComponent(
					{
						allModels,
						enabledModelIds: currentEnabledIds,
						hasEnabledModelsFilter: currentHasFilter,
					},
					{
						onModelToggle: async (modelId, enabled) => {
							if (enabled) currentEnabledIds.add(modelId);
							else currentEnabledIds.delete(modelId);
							currentHasFilter = true;
							await updateSessionModels(currentEnabledIds);
						},
						onEnableAll: async (allModelIds) => {
							currentEnabledIds.clear();
							for (const id of allModelIds) currentEnabledIds.add(id);
							currentHasFilter = false;
							await updateSessionModels(currentEnabledIds);
						},
						onClearAll: async () => {
							currentEnabledIds.clear();
							currentHasFilter = true;
							await updateSessionModels(currentEnabledIds);
						},
						onToggleProvider: async (_provider, modelIds, enabled) => {
							for (const id of modelIds) {
								if (enabled) currentEnabledIds.add(id);
								else currentEnabledIds.delete(id);
							}
							currentHasFilter = true;
							await updateSessionModels(currentEnabledIds);
						},
						onPersist: (enabledIds) => {
							context.settingsManager.setEnabledModels(
								enabledIds.length === allModels.length ? undefined : enabledIds,
							);
							context.showStatus("Model selection saved to settings");
						},
						onCancel: () => {
							done();
							context.ui.requestRender();
						},
					},
				);
				return { component: selector, focus: selector };
			});
		});
	}
}
