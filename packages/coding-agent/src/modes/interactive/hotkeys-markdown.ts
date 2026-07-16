import type { Keybinding } from "@zhachory1/mewrite-tui";
import type { AppKeybinding } from "../../core/keybindings.js";
import { keyText } from "./components/keybinding-hints.js";

export interface HotkeysExtensionShortcut {
	description?: string;
	extensionPath: string;
}

export interface HotkeysMarkdownOptions {
	extensionShortcuts?: ReadonlyMap<string, HotkeysExtensionShortcut>;
	platform?: NodeJS.Platform;
}

export function formatKeyDisplay(key: string): string {
	return key
		.split("/")
		.map((k) =>
			k
				.split("+")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join("/");
}

function getAppKeyDisplay(action: AppKeybinding): string {
	return formatKeyDisplay(keyText(action));
}

function getEditorKeyDisplay(action: Keybinding): string {
	return formatKeyDisplay(keyText(action));
}

export function buildHotkeysMarkdown({
	extensionShortcuts,
	platform = process.platform,
}: HotkeysMarkdownOptions = {}): string {
	const cursorUp = getEditorKeyDisplay("tui.editor.cursorUp");
	const cursorDown = getEditorKeyDisplay("tui.editor.cursorDown");
	const cursorLeft = getEditorKeyDisplay("tui.editor.cursorLeft");
	const cursorRight = getEditorKeyDisplay("tui.editor.cursorRight");
	const cursorWordLeft = getEditorKeyDisplay("tui.editor.cursorWordLeft");
	const cursorWordRight = getEditorKeyDisplay("tui.editor.cursorWordRight");
	const cursorLineStart = getEditorKeyDisplay("tui.editor.cursorLineStart");
	const cursorLineEnd = getEditorKeyDisplay("tui.editor.cursorLineEnd");
	const jumpForward = getEditorKeyDisplay("tui.editor.jumpForward");
	const jumpBackward = getEditorKeyDisplay("tui.editor.jumpBackward");
	const pageUp = getEditorKeyDisplay("tui.editor.pageUp");
	const pageDown = getEditorKeyDisplay("tui.editor.pageDown");

	const submit = getEditorKeyDisplay("tui.input.submit");
	const newLine = getEditorKeyDisplay("tui.input.newLine");
	const deleteWordBackward = getEditorKeyDisplay("tui.editor.deleteWordBackward");
	const deleteWordForward = getEditorKeyDisplay("tui.editor.deleteWordForward");
	const deleteToLineStart = getEditorKeyDisplay("tui.editor.deleteToLineStart");
	const deleteToLineEnd = getEditorKeyDisplay("tui.editor.deleteToLineEnd");
	const yank = getEditorKeyDisplay("tui.editor.yank");
	const yankPop = getEditorKeyDisplay("tui.editor.yankPop");
	const undo = getEditorKeyDisplay("tui.editor.undo");
	const tab = getEditorKeyDisplay("tui.input.tab");

	const interrupt = getAppKeyDisplay("app.interrupt");
	const clear = getAppKeyDisplay("app.clear");
	const exit = getAppKeyDisplay("app.exit");
	const suspend = getAppKeyDisplay("app.suspend");
	const cycleThinkingLevel = getAppKeyDisplay("app.thinking.cycle");
	const cycleModelForward = getAppKeyDisplay("app.model.cycleForward");
	const selectModel = getAppKeyDisplay("app.model.select");
	const expandTools = getAppKeyDisplay("app.tools.expand");
	const toggleThinking = getAppKeyDisplay("app.thinking.toggle");
	const externalEditor = getAppKeyDisplay("app.editor.external");
	const cycleModelBackward = getAppKeyDisplay("app.model.cycleBackward");
	const followUp = getAppKeyDisplay("app.message.followUp");
	const dequeue = getAppKeyDisplay("app.message.dequeue");
	const pasteImage = getAppKeyDisplay("app.clipboard.pasteImage");

	let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

	if (extensionShortcuts && extensionShortcuts.size > 0) {
		hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
		for (const [key, shortcut] of extensionShortcuts) {
			const description = shortcut.description ?? shortcut.extensionPath;
			const keyDisplay = key.replace(/\b\w/g, (c) => c.toUpperCase());
			hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
		}
	}

	return hotkeys;
}
