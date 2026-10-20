import { go } from "@codemirror/lang-go";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";

window.mewriteEditor = {
	create(host, content, filename, onChange) {
		const root = host.attachShadow({ mode: "open" });
		const separator = content.includes("\r\n") ? "\r\n" : content.includes("\r") ? "\r" : "\n";
		const extensions = [
			EditorState.lineSeparator.of(separator),
			EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n|\r|\n/g, state.lineBreak)),
			basicSetup,
			EditorView.lineWrapping,
			EditorView.theme({
				"&": { height: "100%", backgroundColor: "var(--theme-surface)", color: "var(--theme-text)" },
				".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "13px" },
				".cm-content": { minHeight: "220px" },
			}),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) onChange(update.state.sliceDoc());
			}),
		];
		if (/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(filename)) extensions.push(javascript({ typescript: /\.(ts|tsx)$/i.test(filename), jsx: /\.(jsx|tsx)$/i.test(filename) }));
		else if (/\.py$/i.test(filename)) extensions.push(python());
		else if (/\.go$/i.test(filename)) extensions.push(go());
		const view = new EditorView({ doc: content, parent: root, root, extensions });
		return { getContent: () => view.state.sliceDoc(), focus: () => view.focus(), destroy: () => view.destroy() };
	},
};
