/**
 * #152 — agent view list component.
 *
 * Read-only: verifies rows render with state glyphs, selection moves on key
 * input, confirm fires onAttach with the selected session id, and the empty
 * list shows the start hint.
 */

import { setKeybindings } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionRecord } from "../../../src/core/daemon/index.js";
import { KeybindingsManager } from "../../../src/core/keybindings.js";
import { AgentListComponent } from "../../../src/modes/interactive/components/agent-list.js";
import { initTheme } from "../../../src/modes/interactive/theme/theme.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

function rec(id: string, state: SessionRecord["state"], title?: string): SessionRecord {
	return {
		id,
		state,
		title,
		cwd: `/tmp/${id}`,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("#152 agent view list", () => {
	beforeAll(() => {
		setKeybindings(KeybindingsManager.create());
		initTheme(undefined, false);
	});

	it("renders a row per session with a state glyph", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		list.setRows([rec("aaaa1111", "running", "fix-auth"), rec("bbbb2222", "error", "build")]);
		const out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("fix-auth");
		expect(out).toContain("build");
		expect(out).toContain("●"); // running
		expect(out).toContain("✗"); // error
	});

	it("moves selection down and confirm attaches to the selected id", () => {
		const attached: string[] = [];
		const list = new AgentListComponent(
			() => {},
			(id) => attached.push(id),
			() => {},
		);
		list.setRows([rec("first", "idle"), rec("second", "idle"), rec("third", "idle")]);
		list.handleInput(DOWN);
		list.handleInput(DOWN);
		list.handleInput(UP);
		list.handleInput(ENTER);
		expect(attached).toEqual(["second"]);
	});

	it("cancel quits", () => {
		let quit = 0;
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {
				quit++;
			},
		);
		list.setRows([rec("x", "idle")]);
		list.handleInput(ESC);
		expect(quit).toBe(1);
	});

	it("keeps selection stable across polls, clamps when it disappears", () => {
		const attached: string[] = [];
		const list = new AgentListComponent(
			() => {},
			(id) => attached.push(id),
			() => {},
		);
		list.setRows([rec("a", "idle"), rec("b", "idle"), rec("c", "idle")]);
		list.handleInput(DOWN); // select b
		list.setRows([rec("a", "idle"), rec("b", "running"), rec("c", "idle")]); // b still present
		list.handleInput(ENTER);
		expect(attached).toEqual(["b"]);
		// b vanishes -> selection resets to first row
		list.setRows([rec("a", "idle"), rec("c", "idle")]);
		list.handleInput(ENTER);
		expect(attached).toEqual(["b", "a"]);
	});

	it("surfaces a poll error banner and clears it on next successful poll", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		list.setRows([rec("a", "running", "keep-me")]);
		list.setPollError("connect ECONNREFUSED 127.0.0.1:7421");
		let out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("keep-me"); // last rows retained
		expect(out).toContain("daemon unreachable");
		list.setRows([rec("a", "running", "keep-me")]); // successful poll clears error
		out = list.render(80).map(stripAnsi).join("\n");
		expect(out).not.toContain("daemon unreachable");
	});

	it("shows a start hint when there are no agents", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		list.setRows([]);
		const out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("No agents");
		expect(out).toContain("mewrite serve");
	});
});
