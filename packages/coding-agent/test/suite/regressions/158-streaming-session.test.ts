/**
 * #158 phase 5b — live interactive focus pane (StreamingSessionView).
 *
 * Covers: history seeding on attach, streaming assistant tokens rendered as
 * markdown, tool markers, sending on input submit, interrupt, and WS close on
 * dispose. Uses a fake AttachedSession; no real daemon.
 */

import { EventEmitter } from "node:events";
import { setKeybindings } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AttachedSession, CaveClient } from "../../../src/core/daemon/index.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";
import { StreamingSessionView } from "../../../src/modes/interactive/components/streaming-session-view.js";
import { initTheme } from "../../../src/modes/interactive/theme/theme.js";

const ESC = "\x1b";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

class FakeAttached extends EventEmitter {
	sent: string[] = [];
	interrupted = 0;
	closed = false;
	async ready(): Promise<void> {}
	async send(text: string): Promise<{ id: string }> {
		this.sent.push(text);
		return { id: "m" };
	}
	async interrupt(): Promise<{ ok: true }> {
		this.interrupted++;
		return { ok: true };
	}
	close(): void {
		this.closed = true;
	}
}

function mk(opts: { history?: Array<{ role: string; text: string }> } = {}) {
	const ws = new FakeAttached();
	const client = {
		getTranscript: async () => ({
			sessionId: "s",
			messages: (opts.history ?? []).map((m, i) => ({
				id: `${i}`,
				sessionId: "s",
				role: m.role,
				text: m.text,
				createdAt: "",
			})),
		}),
	} as unknown as Pick<CaveClient, "getTranscript">;
	const view = new StreamingSessionView("s", "session", {
		attach: () => ws as unknown as AttachedSession,
		client,
		requestRender: () => {},
		onBack: () => {},
		rows: () => 20,
	});
	return { view, ws };
}

/** Let the async start() (history fetch + attach) settle. */
async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 10));
}

describe("#158 StreamingSessionView", () => {
	beforeAll(() => {
		setKeybindings(KeybindingsManager.create());
		initTheme(undefined, false);
	});

	it("seeds history and renders it", async () => {
		const { view } = mk({
			history: [
				{ role: "user", text: "hi there" },
				{ role: "assistant", text: "hello back" },
			],
		});
		await settle();
		const out = view.render(60).map(stripAnsi).join("\n");
		expect(out).toContain("hi there");
		expect(out).toContain("hello back");
	});

	it("renders streamed assistant tokens (as markdown, not literal)", async () => {
		const { view, ws } = mk();
		await settle();
		ws.emit("token", { sessionId: "s", role: "assistant", text: "**bold** answer" });
		const out = view.render(60).map(stripAnsi).join("\n");
		expect(out).toContain("bold answer");
		expect(out).not.toContain("**bold**");
	});

	it("shows a tool marker on tool activity", async () => {
		const { view, ws } = mk();
		await settle();
		ws.emit("tool", { sessionId: "s", name: "bash", status: "start" });
		const out = view.render(60).map(stripAnsi).join("\n");
		expect(out).toContain("bash");
	});

	it("sends typed input to the session", async () => {
		const { view, ws } = mk();
		await settle();
		for (const ch of "do it") view.handleInput(ch);
		view.handleInput("\r"); // submit
		expect(ws.sent).toEqual(["do it"]);
		// The submitted text echoes optimistically into the transcript.
		expect(view.render(60).map(stripAnsi).join("\n")).toContain("do it");
	});

	it("interrupts a running session", async () => {
		const { view, ws } = mk();
		await settle();
		ws.emit("state", { sessionId: "s", state: "running" });
		view.handleInput(ESC.length === 1 ? "\x1b" : "\x1b"); // app.interrupt default is escape
		expect(ws.interrupted).toBe(1);
	});

	it("closes the WebSocket on dispose", async () => {
		const { view, ws } = mk();
		await settle();
		view.dispose();
		expect(ws.closed).toBe(true);
	});
});
