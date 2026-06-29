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

describe("TUI side panel layout", () => {
	it("preserves bottom-pinned children while a side panel is open", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		tui.addChild(new Lines(["chat"]));
		tui.addChild(new Lines(["meter"]));
		tui.addChild(new Lines(["editor"]));
		tui.setBottomPinnedChildren(2);
		tui.showSidePanel(new Lines(["activity"]), { width: 10 });

		tui.start();
		await new Promise((resolve) => setImmediate(resolve));
		const viewport = await terminal.flushAndGetViewport();
		tui.stop();

		assert.match(viewport[6], /meter/);
		assert.match(viewport[7], /editor/);
	});
});
