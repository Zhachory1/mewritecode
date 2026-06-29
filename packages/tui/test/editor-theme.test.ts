import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor, type EditorTheme, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TUI(new VirtualTerminal(cols, rows));
}

const themedEditor: EditorTheme = {
	borderColor: (text) => `<border>${text}</border>`,
	text: (text) => `<text>${text}</text>`,
	placeholder: (text) => `<placeholder>${text}</placeholder>`,
	cursor: (text) => `<cursor>${text}</cursor>`,
	selectList: {
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
		description: (text) => text,
		scrollInfo: (text) => text,
		noMatch: (text) => text,
	},
};

describe("Editor themed text", () => {
	it("styles typed editor text with the theme", () => {
		const editor = new Editor(createTestTUI(), themedEditor);
		editor.setText("hello");

		const output = editor.render(40).join("\n");

		assert.match(output, /<text>hello<\/text>/);
	});

	it("styles placeholder and cursor with the theme", () => {
		const editor = new Editor(createTestTUI(), themedEditor, { placeholder: "Type here" });
		editor.focused = true;

		const output = editor.render(40).join("\n");

		assert.match(output, /<cursor>T<\/cursor>/);
		assert.match(output, /<placeholder>ype here<\/placeholder>/);
	});
});
