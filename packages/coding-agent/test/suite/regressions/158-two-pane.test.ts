/**
 * #158 phase 5a — two-pane agents view.
 *
 * Covers: two-column render (separator, per-column width, no overflow), ctrl+w
 * pane switch, single-pane fallback below the min width, and jump-to-attention.
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

	it("renders two columns with a separator and never exceeds the width", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle"), rec("b", "running")]);
		for (const width of [80, 100, 133]) {
			const out = view.render(width);
			for (const line of out) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const joined = out.map(stripAnsi).join("\n");
			expect(joined).toContain("│"); // column separator
			expect(joined).toContain("Your agents");
			expect(joined).toContain("Focus");
			expect(joined).toContain("hello from focus"); // focus pane shows selected transcript
		}
	});

	it("falls back to a single pane below the min width", async () => {
		const view = makeView();
		await seed(view, [rec("a", "idle")]);
		const out = view.render(60).map(stripAnsi).join("\n");
		// Sidebar pane only (active); its header shows, no Focus header.
		expect(out).toContain("Your agents");
		expect(out).not.toContain("Focus  (ctrl+w)");
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
		expect(out).toContain("▸ Your agents"); // sidebar active
		view.handleInput(CTRL_W);
		out = view.render(100).map(stripAnsi).join("\n");
		expect(out).toContain("▸ Focus  (ctrl+w)"); // focus active
	});

	it("honors sidebarSide: right puts the sidebar to the right of the separator", async () => {
		const view = mk({
			loadTranscript: async () => [{ role: "assistant", text: "focustext" }],
			sidebarSide: "right",
		});
		await seed(view, [rec("a", "idle")]);
		const headerRow = stripAnsi(view.render(100)[0]);
		const sepAt = headerRow.indexOf("│");
		expect(headerRow.indexOf("Your agents")).toBeGreaterThan(sepAt);
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
