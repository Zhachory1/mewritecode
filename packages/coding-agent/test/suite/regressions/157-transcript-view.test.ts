/**
 * #157 — read-only transcript/detail view for `mewrite agents`.
 *
 * Covers loadTranscript (interactive JSONL read, hosted daemon fetch, error
 * fallback) and the TranscriptView component (header + role-prefixed lines,
 * scroll clamp, esc fires back).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setKeybindings } from "@zhachory1/mewrite-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadTranscript } from "../../../src/cli/agents.js";
import type { CaveClient, SessionRecord, Transcript } from "../../../src/core/daemon/index.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";
import { getDefaultSessionDir } from "../../../src/core/session-manager.js";
import { TranscriptView } from "../../../src/modes/interactive/components/transcript-view.js";
import { initTheme } from "../../../src/modes/interactive/theme/theme.js";

const ENV_AGENT_DIR = "MEWRITE_CODING_AGENT_DIR";
const ESC = "\x1b";
const DOWN = "\x1b[B";

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function interactiveRow(id: string, cwd: string): SessionRecord {
	const now = new Date().toISOString();
	return { id, cwd, state: "idle", createdAt: now, updatedAt: now, kind: "interactive" };
}

describe("#157 loadTranscript", () => {
	let tempDir: string;
	let prevAgentDir: string | undefined;

	beforeEach(() => {
		prevAgentDir = process.env[ENV_AGENT_DIR];
		tempDir = join(tmpdir(), `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		process.env[ENV_AGENT_DIR] = tempDir;
	});

	afterEach(() => {
		if (prevAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = prevAgentDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	const noClient = { getTranscript: async () => ({ sessionId: "x", messages: [] }) } as Pick<
		CaveClient,
		"getTranscript"
	>;

	function seedJsonl(cwd: string, id: string): void {
		const dir = getDefaultSessionDir(cwd);
		const ts = "2026-08-06T00-00-00-000Z";
		const lines = [
			{ type: "session", version: 3, id, timestamp: "2026-08-06T00:00:00.000Z", cwd },
			{
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-08-06T00:00:01.000Z",
				message: { role: "user", content: "hello agent", timestamp: 1 },
			},
			{
				type: "message",
				id: "m2",
				parentId: "m1",
				timestamp: "2026-08-06T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hi there" }],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "claude",
					usage: {},
					stopReason: "end_turn",
					timestamp: 2,
				},
			},
		];
		writeFileSync(join(dir, `${ts}_${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
	}

	it("reads an interactive session's JSONL into role-tagged lines in order", async () => {
		const cwd = "/tmp/proj-a";
		seedJsonl(cwd, "int-1");
		const lines = await loadTranscript(interactiveRow("int-1", cwd), noClient);
		expect(lines.map((l) => l.role)).toEqual(["user", "assistant"]);
		expect(lines[0].text).toContain("hello agent");
		expect(lines[1].text).toContain("hi there");
	});

	it("returns an error line when the interactive transcript file is missing", async () => {
		const lines = await loadTranscript(interactiveRow("missing", "/tmp/proj-none"), noClient);
		expect(lines).toHaveLength(1);
		expect(lines[0].role).toBe("error");
	});

	it("fetches a hosted session's transcript from the daemon", async () => {
		const transcript: Transcript = {
			sessionId: "host-1",
			messages: [
				{ id: "a", sessionId: "host-1", role: "user", text: "q", createdAt: "" },
				{ id: "b", sessionId: "host-1", role: "assistant", text: "a", createdAt: "" },
			],
		};
		const client = { getTranscript: async () => transcript } as Pick<CaveClient, "getTranscript">;
		const row: SessionRecord = {
			id: "host-1",
			cwd: "/tmp/h",
			state: "idle",
			createdAt: "",
			updatedAt: "",
			kind: "hosted",
		};
		const lines = await loadTranscript(row, client);
		expect(lines).toEqual([
			{ role: "user", text: "q" },
			{ role: "assistant", text: "a" },
		]);
	});

	it("returns an error line when the daemon fetch throws", async () => {
		const client = {
			getTranscript: async () => {
				throw new Error("boom");
			},
		} as Pick<CaveClient, "getTranscript">;
		const row: SessionRecord = { id: "h", cwd: "/tmp", state: "idle", createdAt: "", updatedAt: "", kind: "hosted" };
		const lines = await loadTranscript(row, client);
		expect(lines).toHaveLength(1);
		expect(lines[0].role).toBe("error");
		expect(lines[0].text).toContain("boom");
	});
});

describe("#157 TranscriptView", () => {
	beforeAll(() => {
		setKeybindings(KeybindingsManager.create());
		initTheme(undefined, false);
	});

	it("renders a header and role-prefixed lines", () => {
		const view = new TranscriptView(
			"[i] session-1  /tmp/proj",
			() => {},
			() => {},
		);
		view.setLines([
			{ role: "user", text: "hello" },
			{ role: "assistant", text: "world" },
		]);
		const out = view.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("[i] session-1");
		expect(out).toContain("you");
		expect(out).toContain("hello");
		expect(out).toContain("agent");
		expect(out).toContain("world");
		expect(out).toContain("esc/q back");
	});

	it("esc fires onBack", () => {
		let back = 0;
		const view = new TranscriptView(
			"t",
			() => {},
			() => {
				back++;
			},
		);
		view.setLines([{ role: "user", text: "x" }]);
		view.handleInput(ESC);
		expect(back).toBe(1);
	});

	it("scroll clamps and does not throw past the ends", () => {
		const view = new TranscriptView(
			"t",
			() => {},
			() => {},
		);
		view.setLines([
			{ role: "user", text: "a" },
			{ role: "assistant", text: "b" },
		]);
		// Scroll up past the top and down past the bottom; render must stay valid.
		view.handleInput(DOWN);
		view.handleInput(DOWN);
		view.handleInput(DOWN);
		const out = view.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("esc/q back");
	});

	it("shows an empty hint when there are no messages", () => {
		const view = new TranscriptView(
			"t",
			() => {},
			() => {},
		);
		view.setLines([]);
		const out = view.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("No messages yet");
	});
});
