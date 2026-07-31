import { Type } from "@sinclair/typebox";
import { Text, type TUI } from "@zhachory1/mewrite-tui";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import type { ToolDefinition } from "../../../src/core/extensions/types.js";
import { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.js";
import { ToolGroupShellComponent } from "../../../src/modes/interactive/components/tool-shelf.js";
import { initTheme } from "../../../src/modes/interactive/theme/theme.js";

// Issue #134: ctrl+o ("Toggle tool output") did not reach tool rows nested in a
// ToolGroupShellComponent because the group had no setExpanded() and was thus
// not `isExpandable`, so setToolsExpanded() skipped it. It also stayed hidden
// after finalize(). ToolGroupShellComponent.setExpanded() fixes both.

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function makeRow(id: string, callText: string, resultText: string): ToolExecutionComponent {
	const def: ToolDefinition = {
		name: "custom_tool",
		label: "custom_tool",
		description: "custom tool",
		parameters: Type.Any(),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		renderCall: () => new Text(callText, 0, 0),
		renderResult: (_result, options) =>
			new Text(options.expanded ? resultText : "(preview)", 0, 0),
	};
	const row = new ToolExecutionComponent("custom_tool", id, {}, {}, def, createFakeTui());
	row.updateResult({ content: [{ type: "text", text: resultText }], details: {}, isError: false }, false);
	return row;
}

describe("issue #134 ctrl+o expands grouped tool output", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("group is expandable and propagates output expansion to nested rows", () => {
		const group = new ToolGroupShellComponent();
		group.addTool("custom_tool", makeRow("t1", "call-1", "FULL-OUTPUT-1"));
		group.addTool("custom_tool", makeRow("t2", "call-2", "FULL-OUTPUT-2"));

		// isExpandable contract: the group exposes setExpanded().
		expect(typeof (group as unknown as { setExpanded?: unknown }).setExpanded).toBe("function");

		// End of turn: finalize() hides the group (footer summarizes it).
		group.finalize();
		expect(stripAnsi(group.render(120).join("\n")).trim()).toBe("");

		// ctrl+o expand: reveals rows and switches them to full output.
		group.setExpanded(true);
		const expanded = stripAnsi(group.render(120).join("\n"));
		expect(expanded).toContain("FULL-OUTPUT-1");
		expect(expanded).toContain("FULL-OUTPUT-2");
		expect(expanded).not.toContain("(preview)");

		// ctrl+o collapse after finalize: hidden again.
		group.setExpanded(false);
		expect(stripAnsi(group.render(120).join("\n")).trim()).toBe("");
	});

	test("while the turn is live, collapse keeps rows visible as preview", () => {
		const group = new ToolGroupShellComponent();
		group.addTool("custom_tool", makeRow("t1", "call-1", "FULL-OUTPUT-1"));

		// Not finalized: setExpanded(false) must not hide the live group.
		group.setExpanded(false);
		const rendered = stripAnsi(group.render(120).join("\n"));
		expect(rendered).toContain("(preview)");
		expect(rendered).not.toContain("FULL-OUTPUT-1");
	});
});
