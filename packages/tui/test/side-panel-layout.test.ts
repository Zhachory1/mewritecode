import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class Lines implements Component {
	constructor(private readonly lines: string[]) {}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

class InputRecorder extends Lines {
	inputs: string[] = [];
	focused = false;
	handleInput(data: string): void {
		this.inputs.push(data);
	}
}

class MutableLines implements Component {
	constructor(private lines: string[]) {}
	setLines(lines: string[]): void {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

class SpyTerminal extends VirtualTerminal {
	writes: string[] = [];
	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

describe("TUI side panel layout", () => {
	it("preserves editor focus when opened as a passive panel", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		const editor = new InputRecorder(["editor"]);
		const panel = new InputRecorder(["activity"]);
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.showSidePanel(panel, { width: 10, focus: false });

		tui.start();
		terminal.sendInput("x");
		tui.stop();

		assert.deepStrictEqual(editor.inputs, ["x"]);
		assert.deepStrictEqual(panel.inputs, []);
		assert.strictEqual(editor.focused, true);
		assert.strictEqual(panel.focused, false);
	});

	it("does not clear scrollback on shrink while a side panel is open", async () => {
		const terminal = new SpyTerminal(40, 8);
		const tui = new TUI(terminal);
		const main = new MutableLines(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
		tui.setClearOnShrink(true);
		tui.addChild(main);
		tui.showSidePanel(new Lines(["activity"]), { width: 10, focus: false });

		tui.start();
		await new Promise((resolve) => setTimeout(resolve, 25));
		terminal.writes = [];

		main.setLines(["a"]);
		tui.requestRender();
		await new Promise((resolve) => setTimeout(resolve, 25));
		tui.stop();

		assert.ok(!terminal.writes.some((write) => write.includes("\x1b[3J")), terminal.writes.join("\n---\n"));
	});

	it("preserves bottom-pinned children while a side panel is open", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		tui.addChild(new Lines(["chat"]));
		tui.addChild(new Lines(["meter"]));
		tui.addChild(new Lines(["editor"]));
		tui.setBottomPinnedChildren(2);
		tui.showSidePanel(new Lines(["activity"]), { width: 10 });

		tui.start();
		await new Promise((resolve) => setTimeout(resolve, 25));
		const viewport = await terminal.flushAndGetViewport();
		tui.stop();

		assert.match(viewport[6], /meter/);
		assert.match(viewport[7], /editor/);
	});
});
