/**
 * #158 phase 5a — agents view (now full-screen single pane after #185).
 *
 * The side-by-side split was retired in agents view v2 (#185): the flow is
 * list → (select/ctrl+w) → full-screen focus → back. These cover the full-screen
 * render (no separator, no overflow), pane switching, enter-to-focus, and
 * jump-to-attention.
 */

import { EventEmitter } from "node:events";
import { setKeybindings, visibleWidth } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AttachedSession, CaveClient, SessionRecord } from "../../../src/core/daemon/index.js";
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

/** A stub AttachedSession that never emits; enough for the live focus pane. */
function stubAttach(): AttachedSession {
	const e = new EventEmitter() as unknown as AttachedSession;
	(e as unknown as { ready: () => Promise<void> }).ready = async () => {};
	(e as unknown as { send: (t: string) => Promise<{ id: string }> }).send = async () => ({ id: "m" });
	(e as unknown as { interrupt: () => Promise<{ ok: true }> }).interrupt = async () => ({ ok: true });
	(e as unknown as { close: () => void }).close = () => {};
	return e;
}

function makeView(overrides: Partial<Parameters<typeof mk>[0]> = {}) {
	return mk({
		loadTranscript: async (): Promise<TranscriptLine[]> => [{ role: "assistant", text: "hello from focus" }],
		...overrides,
	});
}

function mk(cb: {
	loadTranscript: (row: SessionRecord) => Promise<TranscriptLine[]>;
	sidebarSide?: "left" | "right";
	transcript?: TranscriptLine[];
}) {
	const client = {
		getTranscript: async () => ({
			sessionId: "x",
			messages: (cb.transcript ?? [{ role: "assistant", text: "hello from focus" }]).map((l, i) => ({
				id: `h${i}`,
				sessionId: "x",
				role: l.role,
				text: l.text,
				createdAt: "",
			})),
		}),
	} as unknown as Pick<CaveClient, "getTranscript">;
	return new TwoPaneView(() => {}, {
		onQuit: () => {},
		onDelete: () => {},
		loadTranscript: cb.loadTranscript,
		attach: () => stubAttach(),
		client,
		rows: () => 24,
		sidebarSide: cb.sidebarSide,
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

	it("renders a single full-screen pane (no split separator) within the width", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle"), rec("b", "running")]);
		for (const width of [80, 100, 133]) {
			const out = view.render(width);
			for (const line of out) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const joined = out.map(stripAnsi).join("\n");
			expect(joined).not.toContain("│"); // no side-by-side separator
			expect(joined).toContain("Your agents"); // list is the initial full-screen pane
			expect(joined).not.toContain("Focus  (ctrl+w)"); // focus not shown until selected
		}
	});

	it("ctrl+w switches to the full-screen focus pane", async () => {
		const view = makeView({
			loadTranscript: async () =>
				Array.from({ length: 40 }, (_, i) => ({ role: "assistant" as const, text: `line-${i}` })),
		});
		await seed(view, [rec("a", "idle")]);
		let out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ Your agents"); // list active, no focus column
		expect(out).not.toContain("Focus  (ctrl+w)");
		view.handleInput(CTRL_W);
		out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ Focus  (ctrl+w)"); // focus now full-screen
		expect(out).not.toContain("Your agents"); // list not shown alongside
	});

	it("enter focuses the pane (hosted rows are interactive in place)", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle")]);
		let out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ Your agents"); // sidebar active initially
		view.handleInput("\r"); // enter focuses the focus pane
		out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ Focus  (ctrl+w)");
	});

	it("jump-to-attention focuses the errored session in the focus pane", async () => {
		const view = makeView();
		await seed(view, [rec("ok1", "idle"), rec("ok2", "idle"), rec("boom", "error")]);
		view.handleInput("!"); // jump to the errored row
		// The focus pane's title reflects the now-selected errored session.
		const out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("boom");
	});
});
