/**
 * #173 — the agents focus pane renders the same context meter + thinking level as
 * the interactive footer, fed by the daemon `usage` notification. Before the first
 * usage event it shows just the model id; after, it shows `{percent}/{tokens}` and
 * the thinking level (unless "off").
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { AttachedSession, CaveClient } from "../../../../core/daemon/index.js";
import { initTheme } from "../../theme/theme.js";
import { StreamingSessionView } from "../streaming-session-view.js";

beforeAll(() => initTheme("dark"));

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_SGR, "");

/** Fake AttachedSession that records event listeners so the test can fire them. */
class FakeSession {
	listeners = new Map<string, (p: unknown) => void>();
	on(event: string, listener: (p: unknown) => void): this {
		this.listeners.set(event, listener);
		return this;
	}
	async ready(): Promise<void> {}
	close(): void {}
	fire(event: string, params: unknown): void {
		this.listeners.get(event)?.(params);
	}
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
		const status = statusLine(view);
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
		const status = statusLine(view);
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
		const status = statusLine(view);
		expect(status).toContain("? 0");
		// thinking "off" is not appended.
		expect(status).not.toContain("· off");
		view.dispose();
	});
});
