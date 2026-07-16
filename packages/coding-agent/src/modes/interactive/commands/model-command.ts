import type { Model } from "@zhachory1/mewrite-ai";
import { findExactModelReferenceMatch } from "../../../core/model-resolver.js";
import { ModelSelectorComponent } from "../components/model-selector.js";
import {
	arg,
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

async function getModelCandidates(context: InteractiveSlashCommandContext): Promise<Model<any>[]> {
	if (context.session.scopedModels.length > 0) {
		return context.session.scopedModels.map((scoped) => scoped.model);
	}
	context.session.modelRegistry.refresh();
	try {
		return await context.session.modelRegistry.getAvailable();
	} catch {
		return [];
	}
}

async function findExactModelMatch(
	context: InteractiveSlashCommandContext,
	searchTerm: string,
): Promise<Model<any> | undefined> {
	return findExactModelReferenceMatch(searchTerm, await getModelCandidates(context));
}

function showModelSelector(context: InteractiveSlashCommandContext, initialSearchInput?: string): void {
	context.showSelector((done) => {
		const selector = new ModelSelectorComponent(
			context.ui,
			context.session.model,
			context.settingsManager,
			context.session.modelRegistry,
			context.session.scopedModels,
			async (model) => {
				try {
					await context.session.setModel(model);
					context.invalidateFooter();
					context.updateEditorBorderColor();
					done();
					context.showStatus(`Model: ${model.id}`);
					context.checkDaxnutsEasterEgg(model);
				} catch (error) {
					done();
					context.showError(error instanceof Error ? error.message : String(error));
				}
			},
			() => {
				done();
				context.ui.requestRender();
			},
			initialSearchInput,
		);
		return { component: selector, focus: selector };
	});
}

export class ModelCommand extends InteractiveSlashCommand {
	readonly name = "model";

	condition(text: string): boolean {
		return exactOrArg("/model", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const searchTerm = arg(text, "/model");
			if (!searchTerm) {
				showModelSelector(context);
				return;
			}
			void context.session.modelRegistry.refreshPricingFromSource();
			const model = await findExactModelMatch(context, searchTerm);
			if (model) {
				try {
					await context.session.setModel(model);
					context.invalidateFooter();
					context.updateEditorBorderColor();
					context.showStatus(`Model: ${model.id}`);
					context.checkDaxnutsEasterEgg(model);
				} catch (error) {
					context.showError(error instanceof Error ? error.message : String(error));
				}
				return;
			}
			showModelSelector(context, searchTerm);
		});
	}
}
