/**
 * #158 phase 5b — live interactive session view for the agents focus pane.
 *
 * Renders a daemon session as a live, interactive transcript (streaming markdown +
 * an input box), driven by an AttachedSession WebSocket. Replaces the read-only
 * TranscriptView / attach-REPL handoff for hosted sessions: you type to the agent
 * in-place without leaving the two-pane view.
 *
 * Scope (5b): user + assistant text, send, interrupt. Tool activity shows as a dim
 * one-line marker; faithful tool cards / thinking need richer daemon events (5c).
 */

import {
	type Component,
	type Focusable,
	getKeybindings,
	Input,
	StreamingMarkdown,
	truncateToWidth,
	visibleWidth,
} from "@zhachory1/mewrite-tui";
import type { AttachedSession, CaveClient } from "../../../core/daemon/index.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { UserMessageComponent } from "./user-message.js";

/** Header + status + input chrome rows that don't scroll with the transcript. */
const CHROME_ROWS = 4;

type Block =
	| { kind: "user"; comp: UserMessageComponent }
	| { kind: "assistant"; comp: StreamingMarkdown }
	| { kind: "tool"; text: string };

export interface StreamingSessionDeps {
	/** Open a live WS attach for the session id. */
	attach: (id: string) => AttachedSession;
	/** Fetch the persisted transcript to seed history before the live stream. */
	client: Pick<CaveClient, "getTranscript">;
	requestRender: () => void;
	/** Leave the focus pane (e.g. esc on an empty input). */
	onBack: () => void;
	/** Viewport height in rows. */
	rows: () => number;
}

export class StreamingSessionView implements Component, Focusable {
	focused = true;
	private readonly input = new Input();
	private blocks: Block[] = [];
	private session: AttachedSession | null = null;
	private state = "idle";
	private streamRole: "assistant" | null = null;
	private disposed = false;
	private offsetFromBottom = 0;

	constructor(
		private readonly sessionId: string,
		private readonly title: string,
		private readonly deps: StreamingSessionDeps,
	) {
		this.input.focused = true;
		this.input.onSubmit = (value) => this.submit(value);
		this.input.onEscape = () => {
			// Esc backs out only when the input is empty; otherwise it clears the line.
			if (this.input.getValue().length === 0) this.deps.onBack();
			else this.input.setValue("");
			this.deps.requestRender();
		};
		void this.start();
	}

	private async start(): Promise<void> {
		// Seed history (best-effort), then open the live stream.
		try {
			const transcript = await this.deps.client.getTranscript(this.sessionId);
			for (const m of transcript.messages) {
				if (!m.text.trim()) continue;
				if (m.role === "user") this.pushUser(m.text);
				else this.pushAssistantFinal(m.text);
			}
		} catch {
			/* no history available */
		}
		if (this.disposed) return;
		const s = this.deps.attach(this.sessionId);
		this.session = s;
		s.on("token", (p) => this.onToken(p as { text?: string; role?: string }));
		s.on("tool", (p) => this.onTool(p as { name?: string; status?: string }));
		s.on("state", (p) => this.onState(p as { state?: string }));
		s.on("done", () => this.endStream());
		s.on("error", () => {
			this.state = "error";
			this.deps.requestRender();
		});
		this.deps.requestRender();
	}

	private pushUser(text: string): void {
		this.blocks.push({ kind: "user", comp: new UserMessageComponent(text) });
	}

	private pushAssistantFinal(text: string): void {
		const md = new StreamingMarkdown(text, 0, 0, getMarkdownTheme());
		md.setText(text);
		this.blocks.push({ kind: "assistant", comp: md });
	}

	private onToken(p: { text?: string; role?: string }): void {
		if (typeof p.text !== "string") return;
		if (p.role !== "assistant") return; // user echo handled optimistically on submit
		if (this.streamRole !== "assistant") {
			const md = new StreamingMarkdown("", 0, 0, getMarkdownTheme());
			this.blocks.push({ kind: "assistant", comp: md });
			this.streamRole = "assistant";
		}
		const last = this.blocks[this.blocks.length - 1];
		if (last?.kind === "assistant") last.comp.append(p.text);
		this.offsetFromBottom = 0; // follow the tail as new text streams in
		this.deps.requestRender();
	}

	private onTool(p: { name?: string; status?: string }): void {
		this.endStream();
		this.blocks.push({ kind: "tool", text: `⚙ ${p.name ?? "tool"} (${p.status ?? ""})` });
		this.deps.requestRender();
	}

	private onState(p: { state?: string }): void {
		if (typeof p.state === "string") {
			this.state = p.state;
			this.deps.requestRender();
		}
	}

	private endStream(): void {
		this.streamRole = null;
	}

	private submit(value: string): void {
		const text = value.trim();
		if (!text) return;
		this.pushUser(text); // optimistic echo
		this.input.setValue("");
		this.offsetFromBottom = 0;
		this.endStream();
		void this.session?.send(text).catch(() => {
			this.blocks.push({ kind: "tool", text: "(failed to send)" });
			this.deps.requestRender();
		});
		this.deps.requestRender();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "app.interrupt") && this.state === "running") {
			void this.session?.interrupt().catch(() => {});
			return;
		}
		if (kb.matches(data, "tui.select.pageUp")) {
			this.offsetFromBottom += 10;
			this.deps.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.pageDown")) {
			this.offsetFromBottom = Math.max(0, this.offsetFromBottom - 10);
			this.deps.requestRender();
			return;
		}
		// Everything else goes to the input editor.
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate?.();
		for (const b of this.blocks) if (b.kind !== "tool") b.comp.invalidate?.();
	}

	dispose(): void {
		this.disposed = true;
		this.session?.close();
		this.session = null;
	}

	private renderBody(width: number): string[] {
		const out: string[] = [];
		for (const b of this.blocks) {
			if (out.length > 0) out.push("");
			if (b.kind === "tool") out.push(theme.fg("dim", truncateToWidth(`  ${b.text}`, width)));
			else for (const line of b.comp.render(width)) out.push(truncateToWidth(line, width));
		}
		return out;
	}

	render(width: number): string[] {
		const viewport = Math.max(1, this.deps.rows());
		const bodyRows = Math.max(1, viewport - CHROME_ROWS);
		const body = this.renderBody(width);
		const maxOffset = Math.max(0, body.length - bodyRows);
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		const end = body.length - this.offsetFromBottom;
		const start = Math.max(0, end - bodyRows);
		const windowed = body.slice(start, end);
		// Pad so the input sticks to the bottom of the pane.
		while (windowed.length < bodyRows) windowed.push("");

		const lines: string[] = [];
		lines.push(theme.bold(truncateToWidth(this.title, width)));
		lines.push(...windowed);
		const statusLabel =
			this.state === "running" ? theme.fg("accent", "● running") : theme.fg("dim", `○ ${this.state}`);
		const following = this.offsetFromBottom === 0 ? "" : "  ↑ scrolled";
		lines.push(theme.fg("dim", truncateToWidth(`${stripToWidth(statusLabel, width)}${following}`, width)));
		// Input line (its own cursor marker positions the hardware cursor).
		lines.push(...this.input.render(width));
		return lines;
	}
}

/** Truncate a possibly-ANSI status fragment without dropping its trailing reset. */
function stripToWidth(s: string, width: number): string {
	return visibleWidth(s) > width ? truncateToWidth(s, width) : s;
}
