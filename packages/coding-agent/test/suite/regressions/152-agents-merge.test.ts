/**
 * #152 phase 2 — `mewrite agents` merge of hosted + live interactive sessions.
 *
 * Covers loadRows: kind tagging, stopped-exclusion, id dedupe (interactive
 * wins), stable id sort (#221), and daemon-down still surfacing live rows.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRows } from "../../../src/cli/agents.js";
import type { CaveClient, SessionRecord } from "../../../src/core/daemon/index.js";
import { getLiveDir, type LiveRecord } from "../../../src/core/live-registry.js";

const ENV_AGENT_DIR = "MEWRITE_CODING_AGENT_DIR";

let tempDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
	prevAgentDir = process.env[ENV_AGENT_DIR];
	tempDir = join(tmpdir(), `agents-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	process.env[ENV_AGENT_DIR] = tempDir;
});

afterEach(() => {
	if (prevAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = prevAgentDir;
	rmSync(tempDir, { recursive: true, force: true });
});

function hostedRow(id: string, state: SessionRecord["state"], updatedAt: string): SessionRecord {
	return { id, state, cwd: `/tmp/${id}`, createdAt: updatedAt, updatedAt };
}

function seedLive(id: string, updatedAt: string, pid: number = process.pid): void {
	mkdirSync(getLiveDir(), { recursive: true });
	const rec: LiveRecord = { id, pid, cwd: `/tmp/${id}`, state: "running", updatedAt };
	writeFileSync(join(getLiveDir(), `${id}.json`), JSON.stringify(rec));
}

function stubClient(rows: SessionRecord[] | (() => never)): Pick<CaveClient, "listSessions"> {
	return {
		listSessions: async () => {
			if (typeof rows === "function") rows();
			return rows as SessionRecord[];
		},
	} as Pick<CaveClient, "listSessions">;
}

describe("#152 agents merge", () => {
	it("tags kinds, excludes stopped hosted rows, and sorts by stable id (#221)", async () => {
		const client = stubClient([
			hostedRow("h-old", "idle", "2024-01-01T00:00:00.000Z"),
			hostedRow("h-stopped", "stopped", "2024-06-01T00:00:00.000Z"),
		]);
		seedLive("live-new", "2024-12-01T00:00:00.000Z");

		const rows = await loadRows(client);
		expect(rows.map((r) => r.id)).toEqual(["h-old", "live-new"]);
		expect(rows.find((r) => r.id === "live-new")?.kind).toBe("interactive");
		expect(rows.find((r) => r.id === "h-old")?.kind).toBe("hosted");
		expect(rows.some((r) => r.id === "h-stopped")).toBe(false);
	});

	it("#221 keeps order stable when only updatedAt churns", async () => {
		const first = stubClient([
			hostedRow("a-1", "idle", "2024-01-01T00:00:00.000Z"),
			hostedRow("b-2", "idle", "2024-01-02T00:00:00.000Z"),
		]);
		const before = (await loadRows(first)).map((r) => r.id);
		// Same rows, but b-2 is now the most recently updated: order must not flip.
		const second = stubClient([
			hostedRow("a-1", "idle", "2024-01-01T00:00:00.000Z"),
			hostedRow("b-2", "idle", "2024-12-31T00:00:00.000Z"),
		]);
		const after = (await loadRows(second)).map((r) => r.id);
		expect(after).toEqual(before);
		expect(after).toEqual(["a-1", "b-2"]);
	});

	it("interactive wins on id collision with a hosted row", async () => {
		const client = stubClient([hostedRow("dup", "idle", "2024-01-01T00:00:00.000Z")]);
		seedLive("dup", "2024-12-01T00:00:00.000Z");
		const rows = await loadRows(client);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("interactive");
	});

	it("daemon down still surfaces live rows", async () => {
		const client = stubClient(() => {
			throw new Error("connect ECONNREFUSED 127.0.0.1:7421");
		});
		seedLive("live-only", "2024-12-01T00:00:00.000Z");
		const rows = await loadRows(client);
		expect(rows.map((r) => r.id)).toEqual(["live-only"]);
		expect(rows[0].kind).toBe("interactive");
	});

	it("ownedPids scopes out foreign interactive sessions (Option A)", async () => {
		// Both pids must be alive or listLiveInteractive reaps them before scoping;
		// use this process (owned) and its parent (foreign but alive).
		const mine = process.pid;
		const foreign = process.ppid;
		const client = stubClient([hostedRow("h-keep", "idle", "2024-01-01T00:00:00.000Z")]);
		seedLive("mine", "2024-12-02T00:00:00.000Z", mine);
		seedLive("foreign", "2024-12-03T00:00:00.000Z", foreign);
		const rows = await loadRows(client, new Set([mine]));
		// Owned live row + hosted row survive; the foreign interactive row is dropped.
		expect(rows.map((r) => r.id).sort()).toEqual(["h-keep", "mine"]);
		expect(rows.some((r) => r.id === "foreign")).toBe(false);
	});

	it("empty ownedPids hides all live interactive rows but keeps hosted", async () => {
		const client = stubClient([hostedRow("h-keep", "idle", "2024-01-01T00:00:00.000Z")]);
		seedLive("foreign", "2024-12-03T00:00:00.000Z", process.pid);
		const rows = await loadRows(client, new Set());
		expect(rows.map((r) => r.id)).toEqual(["h-keep"]);
	});
});
