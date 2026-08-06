/**
 * #158 phase 5a — two-pane agents view.
 *
 * Covers: two-column render (separator, per-column width, no overflow), ctrl+w
 * pane switch, single-pane fallback below the min width, and jump-to-attention.
 */

import { setKeybindings, visibleWidth } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionRecord } from "../../../src/core/daemon/index.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";
import type { TranscriptLine } from "../../../src/modes/interactive/components/transcript-view.js";
import { TwoPaneView } from "../../../src/modes/interactive/components/two-pane-view.js";
import { initTheme } from "../../../src/modes/interactive/theme/theme.js";

const CTRL_W = "\x17";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function rec(id: string, state: SessionRecord["state"], kind: SessionRecord["kind"] = "hosted"): SessionRecord {
	const now = new Date().toISOString();
	return { id, state, kind, cwd: `/tmp/${id}`, createdAt: now, updatedAt: now };
}

function makeView(overrides: Partial<Parameters<typeof mk>[0]> = {}) {
	return mk({
		loadTranscript: async (): Promise<TranscriptLine[]> => [{ role: "assistant", text: "hello from focus" }],
		...overrides,
	});
}

function mk(cb: {
	loadTranscript: (row: SessionRecord) => Promise<TranscriptLine[]>;
	onAttach?: (row: SessionRecord) => void;
}) {
	return new TwoPaneView(() => {}, {
		onAttach: cb.onAttach ?? (() => {}),
		onQuit: () => {},
		onDelete: () => {},
		loadTranscript: cb.loadTranscript,
		rows: () => 24,
	});
}

/** setRows + let the async transcript load settle. */
async function seed(view: TwoPaneView, rows: SessionRecord[]): Promise<void> {
	view.setRows(rows);
	await new Promise((r) => setTimeout(r, 5));
}

describe("#158 TwoPaneView", () => {
	beforeAll(() => {
		setKeybindings(KeybindingsManager.create());
		initTheme(undefined, false);
	});

	it("renders two columns with a separator and never exceeds the width", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle"), rec("b", "running")]);
		for (const width of [80, 100, 133]) {
			const out = view.render(width);
			for (const line of out) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const joined = out.map(stripAnsi).join("\n");
			expect(joined).toContain("│"); // column separator
			expect(joined).toContain("agents");
			expect(joined).toContain("focus");
			expect(joined).toContain("hello from focus"); // focus pane shows selected transcript
		}
	});

	it("falls back to a single pane below the min width", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle")]);
		const out = view.render(60).map(stripAnsi).join("\n");
		// Sidebar only; no focus-pane header, still width-safe.
		expect(out).toContain("Agents");
		expect(out).not.toContain("focus (ctrl+w)");
		for (const line of view.render(60)) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
	});

	it("ctrl+w routes input to the focus pane", async () => {
		// A tall transcript so the focus pane has something to scroll; we assert the
		// switch by observing the active-pane cue moving to the focus column.
		const view = makeView({
			loadTranscript: async () =>
				Array.from({ length: 40 }, (_, i) => ({ role: "assistant" as const, text: `line-${i}` })),
		});
		await seed(view, [rec("a", "idle")]);
		let out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ agents"); // sidebar active
		view.handleInput(CTRL_W);
		out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ focus (ctrl+w)"); // focus active
	});

	it("jump-to-attention selects the errored row", async () => {
		const attached: string[] = [];
		const view = mk({
			loadTranscript: async () => [{ role: "assistant", text: "x" }],
			onAttach: (row) => attached.push(row.id),
		});
		await seed(view, [rec("ok1", "idle"), rec("ok2", "idle"), rec("boom", "error")]);
		// Jump to attention, then enter -> attaches the selected (errored) row.
		view.handleInput("!");
		view.handleInput("\r");
		expect(attached).toEqual(["boom"]);
	});
});
