/**
 * #173 — the agents focus pane renders the same context meter + thinking level as
 * the interactive footer, fed by the daemon `usage` notification. Before the first
 * usage event it shows just the model id; after, it shows `{percent}/{tokens}` and
 * the thinking level (unless "off").
 */

import { setKeybindings } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AttachedSession, CaveClient } from "../../../../core/daemon/index.js";
import { KeybindingsManager } from "../../../../core/keybindings.js";
import { initTheme } from "../../theme/theme.js";
import { StreamingSessionView } from "../streaming-session-view.js";

const SHIFT_TAB = "\x1b[Z";
const CTRL_O = "\x0f";

beforeAll(() => {
	setKeybindings(KeybindingsManager.create());
	initTheme("dark");
});

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_SGR, "");

/** Fake AttachedSession that records event listeners so the test can fire them. */
class FakeSession {
	listeners = new Map<string, (p: unknown) => void>();
	thinkingCalls: string[] = [];
	on(event: string, listener: (p: unknown) => void): this {
		this.listeners.set(event, listener);
		return this;
	}
	async ready(): Promise<void> {}
	close(): void {}
	async setThinking(level: string): Promise<{ ok: true }> {
		this.thinkingCalls.push(level);
		return { ok: true };
	}
	async interrupt(): Promise<{ ok: true }> {
		return { ok: true };
	}
	fire(event: string, params: unknown): void {
		this.listeners.get(event)?.(params);
	}
}

function body(view: StreamingSessionView, width = 80): string {
	return view.render(width).map(stripAnsi).join("\n");
}

function makeView(model?: string): { view: StreamingSessionView; session: FakeSession } {
	const session = new FakeSession();
	const client = { getTranscript: async () => ({ sessionId: "s1", messages: [] }) } as unknown as Pick<
		CaveClient,
		"getTranscript"
	>;
	const view = new StreamingSessionView("s1", "Agent", {
		attach: () => session as unknown as AttachedSession,
		client,
		requestRender: () => {},
		onBack: () => {},
		rows: () => 24,
		model,
	});
	return { view, session };
}

// The view subscribes in an async start() (after awaiting getTranscript), so yield
// a macrotask before firing events.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function statusLine(view: StreamingSessionView, width = 80): string {
	const lines = view.render(width).map(stripAnsi);
	// Status line is the row right after the dim horizontal rule.
	const ruleIdx = lines.findIndex((l) => l.startsWith("─"));
	return lines[ruleIdx + 1] ?? "";
}

describe("StreamingSessionView status line — context meter (#173)", () => {
	it("shows only the model id before any usage event", async () => {
		const { view } = makeView("anthropic/claude");
		await tick();
		const status = statusLine(view, 120);
		expect(status).toContain("anthropic/claude");
		expect(status).not.toContain("%");
		view.dispose();
	});

	it("renders a usage bar (percent + used tokens) + thinking level after a usage event", async () => {
		const { view, session } = makeView("anthropic/claude");
		await tick();
		session.fire("usage", {
			sessionId: "s1",
			tokens: 40_000,
			contextWindow: 200_000,
			percent: 20,
			thinkingLevel: "high",
		});
		const status = statusLine(view, 120);
		// Bar: ~20% of 15 cells filled, then percent + used-token count.
		expect(status).toContain("█");
		expect(status).toContain("░");
		expect(status).toContain("20% 40k");
		expect(status).toContain("anthropic/claude · high");
		view.dispose();
	});

	it("renders '?' percent (empty bar) when tokens are unknown (post-compaction)", async () => {
		const { view, session } = makeView("m");
		await tick();
		session.fire("usage", {
			sessionId: "s1",
			tokens: null,
			contextWindow: 200_000,
			percent: null,
			thinkingLevel: "off",
		});
		const status = statusLine(view, 120);
		expect(status).toContain("? 0");
		// thinking "off" is not appended.
		expect(status).not.toContain("· off");
		view.dispose();
	});
});

describe("StreamingSessionView steering — shift+tab thinking cycle (#175)", () => {
	it("cycles the thinking level via setThinking, seeded from the latest usage event", async () => {
		const { view, session } = makeView("m");
		await tick();
		// No usage yet -> current level defaults to "off" -> next is "minimal".
		view.handleInput(SHIFT_TAB);
		expect(session.thinkingCalls).toEqual(["minimal"]);

		// A usage event sets the current level; next press advances from there.
		session.fire("usage", { sessionId: "s1", tokens: 1, contextWindow: 200_000, percent: 0, thinkingLevel: "low" });
		view.handleInput(SHIFT_TAB);
		expect(session.thinkingCalls).toEqual(["minimal", "medium"]);
		view.dispose();
	});

	it("wraps from the top level back to off", async () => {
		const { view, session } = makeView("m");
		await tick();
		session.fire("usage", { sessionId: "s1", tokens: 1, contextWindow: 200_000, percent: 0, thinkingLevel: "high" });
		view.handleInput(SHIFT_TAB);
		expect(session.thinkingCalls).toEqual(["off"]);
		view.dispose();
	});
});

describe("StreamingSessionView steering — ctrl+o tool output expansion (#175)", () => {
	it("toggles tool blocks between compact and expanded (args/result)", async () => {
		const { view, session } = makeView("m");
		await tick();
		session.fire("tool", {
			sessionId: "s1",
			name: "read",
			status: "start",
			toolCallId: "tc1",
			args: { path: "a.txt" },
		});
		session.fire("tool", {
			sessionId: "s1",
			name: "read",
			status: "ok",
			toolCallId: "tc1",
			result: { text: "hello" },
			isError: false,
		});

		// Compact by default: header only, no args/result.
		let out = body(view);
		expect(out).toContain("⚙ read (ok)");
		expect(out).not.toContain("a.txt");

		// ctrl+o expands: args + result visible.
		view.handleInput(CTRL_O);
		out = body(view);
		expect(out).toContain("a.txt");
		expect(out).toContain("hello");

		// ctrl+o again collapses.
		view.handleInput(CTRL_O);
		out = body(view);
		expect(out).not.toContain("a.txt");
		view.dispose();
	});

	it("correlates start and end onto a single tool block by toolCallId", async () => {
		const { view, session } = makeView("m");
		await tick();
		session.fire("tool", { sessionId: "s1", name: "bash", status: "start", toolCallId: "tc9", args: { cmd: "ls" } });
		session.fire("tool", {
			sessionId: "s1",
			name: "bash",
			status: "err",
			toolCallId: "tc9",
			result: "boom",
			isError: true,
		});
		view.handleInput(CTRL_O);
		const out = body(view);
		// One header, reflecting the end status, with the error field.
		expect(out).toContain("⚙ bash (err)");
		expect(out).toContain("error: boom");
		expect(out.match(/⚙ bash/g)?.length).toBe(1);
		view.dispose();
	});
});
