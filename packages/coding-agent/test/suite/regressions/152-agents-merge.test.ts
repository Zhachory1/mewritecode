/**
 * #152 phase 2 — `mewrite agents` merge of hosted + live interactive sessions.
 *
 * Covers loadRows: kind tagging, stopped-exclusion, id dedupe (interactive
 * wins), updatedAt-desc sort, and daemon-down still surfacing live rows.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDaemonUnreachable, loadRows } from "../../../src/cli/agents.js";
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

function seedLive(id: string, updatedAt: string): void {
	mkdirSync(getLiveDir(), { recursive: true });
	const rec: LiveRecord = { id, pid: process.pid, cwd: `/tmp/${id}`, state: "running", updatedAt };
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
	it("tags kinds, excludes stopped hosted rows, and sorts newest first", async () => {
		const client = stubClient([
			hostedRow("h-old", "idle", "2024-01-01T00:00:00.000Z"),
			hostedRow("h-stopped", "stopped", "2024-06-01T00:00:00.000Z"),
		]);
		seedLive("live-new", "2024-12-01T00:00:00.000Z");

		const rows = await loadRows(client);
		expect(rows.map((r) => r.id)).toEqual(["live-new", "h-old"]);
		expect(rows.find((r) => r.id === "live-new")?.kind).toBe("interactive");
		expect(rows.find((r) => r.id === "h-old")?.kind).toBe("hosted");
		expect(rows.some((r) => r.id === "h-stopped")).toBe(false);
	});

	it("interactive wins on id collision with a hosted row", async () => {
		const client = stubClient([hostedRow("dup", "idle", "2024-01-01T00:00:00.000Z")]);
		seedLive("dup", "2024-12-01T00:00:00.000Z");
		const rows = await loadRows(client);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("interactive");
	});

	it("detects a connection failure wrapped in an undici cause chain", () => {
		// undici fetch throws `TypeError: fetch failed` with the real code in `cause`.
		const wrapped = new TypeError("fetch failed");
		(wrapped as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:7421"), {
			code: "ECONNREFUSED",
		});
		expect(isDaemonUnreachable(wrapped)).toBe(true);
		expect(isDaemonUnreachable(new Error("connect ECONNREFUSED 127.0.0.1:7421"))).toBe(true);
		expect(isDaemonUnreachable(new Error("GET /v1/sessions → 500: boom"))).toBe(false);
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
});
