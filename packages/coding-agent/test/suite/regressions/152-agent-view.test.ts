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

function rec(id: string, state: SessionRecord["state"], title?: string, kind?: SessionRecord["kind"]): SessionRecord {
	return {
		id,
		state,
		title,
		kind,
		cwd: `/tmp/${id}`,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

/** A row whose updatedAt is `daysAgo` days in the past. */
function oldRec(id: string, state: SessionRecord["state"], daysAgo: number): SessionRecord {
	const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();
	return { id, state, cwd: `/tmp/${id}`, kind: "hosted", createdAt: ts, updatedAt: ts };
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

	it("moves selection down and confirm selects the highlighted row", () => {
		const attached: string[] = [];
		const list = new AgentListComponent(
			() => {},
			(row) => attached.push(row.id),
			() => {},
		);
		list.setRows([rec("first", "idle"), rec("second", "idle"), rec("third", "idle")]);
		list.handleInput(DOWN);
		list.handleInput(DOWN);
		list.handleInput(UP);
		list.handleInput(ENTER);
		expect(attached).toEqual(["second"]);
	});

	it("esc and q both quit", () => {
		let quit = 0;
		const mk = () =>
			new AgentListComponent(
				() => {},
				() => {},
				() => {
					quit++;
				},
			);
		const esc = mk();
		esc.setRows([rec("x", "idle")]);
		esc.handleInput(ESC);
		const q = mk();
		q.setRows([rec("x", "idle")]);
		q.handleInput("q");
		expect(quit).toBe(2);
	});

	it("hides stale idle rows by default, keeps running/recent, and `a` reveals all", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		list.setRows([
			oldRec("stale", "idle", 3), // 3d old idle -> hidden by default
			oldRec("running-old", "running", 3), // running always shows
			rec("fresh", "idle"), // recent idle shows
		]);
		let out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("running-old");
		expect(out).toContain("fresh");
		expect(out).not.toContain("stale");
		expect(out).toContain("show all (+1)");
		// Toggle show-all with `a`.
		list.handleInput("a");
		out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("stale");
		expect(out).toContain("showing all");
	});

	it("interactive rows are never hidden even if the timestamp is old", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		const ts = new Date(Date.now() - 10 * 86400000).toISOString();
		list.setRows([
			{ id: "live", state: "idle", cwd: "/tmp/live", kind: "interactive", createdAt: ts, updatedAt: ts },
		]);
		const out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("live");
	});

	it("d fires onDelete for a hosted row but not an interactive one", () => {
		const deleted: string[] = [];
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
			() => {},
			(row) => deleted.push(row.id),
		);
		// Interactive row selected -> d is a no-op (no delete endpoint).
		list.setRows([rec("live", "running", undefined, "interactive")]);
		list.handleInput("d");
		expect(deleted).toEqual([]);
		// Hosted row selected -> d fires onDelete with the row.
		list.setRows([rec("hosted-1", "idle", undefined, "hosted")]);
		list.handleInput("d");
		expect(deleted).toEqual(["hosted-1"]);
	});

	it("n triggers onNew", () => {
		let created = 0;
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
			() => {
				created++;
			},
		);
		list.setRows([rec("x", "idle")]);
		list.handleInput("n");
		expect(created).toBe(1);
	});

	it("keeps selection stable across polls, clamps when it disappears", () => {
		const attached: string[] = [];
		const list = new AgentListComponent(
			() => {},
			(row) => attached.push(row.id),
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

	it("marks interactive rows with [i] and leaves hosted rows unmarked", () => {
		const list = new AgentListComponent(
			() => {},
			() => {},
			() => {},
		);
		list.setRows([
			rec("aaaa1111", "running", "interactive-one", "interactive"),
			rec("bbbb2222", "idle", "hosted-one", "hosted"),
		]);
		const out = list.render(80).map(stripAnsi).join("\n");
		expect(out).toContain("[i] interactive-one");
		expect(out).toContain("hosted-one");
		expect(out).not.toContain("[d]");
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
		expect(out).toContain("new agent");
	});
});
