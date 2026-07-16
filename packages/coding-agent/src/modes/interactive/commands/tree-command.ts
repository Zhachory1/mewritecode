import { Loader, Spacer } from "@zhachory1/mewrite-tui";
import { keyText } from "../components/keybinding-hints.js";
import { TreeSelectorComponent } from "../components/tree-selector.js";
import { theme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class TreeCommand extends InteractiveSlashCommand {
	readonly name = "tree";

	condition(text: string): boolean {
		return exact("/tree", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		const tree = context.sessionManager.getTree();
		const realLeafId = context.sessionManager.getLeafId();
		const initialFilterMode = context.settingsManager.getTreeFilterMode();

		if (tree.length === 0) {
			context.showStatus("No entries in session");
			context.clearEditor();
			return;
		}

		const openTree = (initialSelectedId?: string) => {
			context.showSelector((done) => {
				const selector = new TreeSelectorComponent(
					tree,
					realLeafId,
					context.ui.terminal.rows,
					async (entryId) => {
						if (entryId === realLeafId) {
							done();
							context.showStatus("Already at this point");
							return;
						}

						done();
						let wantsSummary = false;
						let customInstructions: string | undefined;

						if (!context.settingsManager.getBranchSummarySkipPrompt()) {
							while (true) {
								const summaryChoice = await context.showExtensionSelector("Summarize branch?", [
									"No summary",
									"Summarize",
									"Summarize with custom prompt",
								]);

								if (summaryChoice === undefined) {
									openTree(entryId);
									return;
								}

								wantsSummary = summaryChoice !== "No summary";

								if (summaryChoice === "Summarize with custom prompt") {
									customInstructions = await context.showExtensionEditor("Custom summarization instructions");
									if (customInstructions === undefined) continue;
								}
								break;
							}
						}

						let summaryLoader: Loader | undefined;
						const originalOnEscape = context.getDefaultEditorEscape();
						if (wantsSummary) {
							context.setDefaultEditorEscape(() => context.session.abortBranchSummary());
							context.chatContainer.addChild(new Spacer(1));
							summaryLoader = new Loader(
								context.ui,
								(spinner) => theme.fg("accent", spinner),
								(text) => theme.fg("muted", text),
								`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
							);
							context.statusContainer.addChild(summaryLoader);
							context.ui.requestRender();
						}

						try {
							const result = await context.session.navigateTree(entryId, {
								summarize: wantsSummary,
								customInstructions,
							});
							if (result.aborted) {
								context.showStatus("Branch summarization cancelled");
								openTree(entryId);
								return;
							}
							if (result.cancelled) {
								context.showStatus("Navigation cancelled");
								return;
							}
							context.disposeMountedToolRows();
							context.chatContainer.clear();
							context.renderInitialMessages();
							if (result.editorText && !context.editor.getText().trim())
								context.editor.setText(result.editorText);
							context.showStatus("Navigated to selected point");
						} catch (error) {
							context.showError(error instanceof Error ? error.message : String(error));
						} finally {
							if (summaryLoader) {
								summaryLoader.stop();
								context.statusContainer.clear();
							}
							context.setDefaultEditorEscape(originalOnEscape);
						}
					},
					() => {
						done();
						context.ui.requestRender();
					},
					(entryId, label) => {
						context.sessionManager.appendLabelChange(entryId, label);
						context.ui.requestRender();
					},
					initialSelectedId,
					initialFilterMode,
				);
				return { component: selector, focus: selector };
			});
		};

		context.clearEditor();
		openTree();
	}
}
