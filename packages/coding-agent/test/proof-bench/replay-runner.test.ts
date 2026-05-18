import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REPLAY_CONFIGS } from "./ablation-matrix.js";
import { replayAll, replayAllLayersOnBaseline, replayAllWithBaseline, replaySession } from "./replay-runner.js";

/**
 * Synthesize a minimal session .jsonl file with known tool results so we can
 * assert exact token deltas from replay configs.
 */
function writeSyntheticSession(dir: string): string {
	const path = join(dir, "synthetic.jsonl");
	const lines: string[] = [];

	// Session header
	lines.push(JSON.stringify({ type: "session", id: "synthetic", cwd: "/tmp", timestamp: "2026-01-01" }));

	// Huge bash output — exercise flint budget
	const hugeBash = Array.from({ length: 500 }, (_, i) => `line-${i}: ${"a".repeat(80)}`).join("\n");
	lines.push(
		JSON.stringify({
			message: {
				role: "toolResult",
				toolName: "bash",
				toolCallId: "t1",
				content: [{ type: "text", text: hugeBash }],
			},
		}),
	);

	// Valid JSON payload — exercise stone structured compression
	const bigJson = JSON.stringify({
		State: { Status: "running", Pid: 42 },
		Config: { Hostname: "abc", Env: Array.from({ length: 50 }, (_, i) => `VAR_${i}=value${i}`) },
		NetworkSettings: { Ports: {}, IPAddress: "172.17.0.2" },
		Mounts: Array.from({ length: 30 }, (_, i) => ({ Source: `/host/${i}`, Destination: `/container/${i}` })),
	});
	lines.push(
		JSON.stringify({
			message: {
				role: "toolResult",
				toolName: "bash",
				toolCallId: "t2",
				content: [{ type: "text", text: bigJson }],
			},
		}),
	);

	// Two identical read tool results — exercise dedup
	const fileContent = `export function foo() { return ${"x".repeat(2000)}; }\n`.repeat(5);
	for (const id of ["t3", "t4"]) {
		lines.push(
			JSON.stringify({
				message: {
					role: "toolResult",
					toolName: "read",
					toolCallId: id,
					content: [{ type: "text", text: fileContent }],
				},
			}),
		);
	}

	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}

describe("replay-runner", () => {
	let sessionPath: string;

	beforeAll(() => {
		const dir = mkdtempSync(join(tmpdir(), "replay-bench-"));
		sessionPath = writeSyntheticSession(dir);
	});

	it("produces rows for every replay config when called via replayAll", () => {
		const rows = replayAll([sessionPath]);
		expect(rows).toHaveLength(REPLAY_CONFIGS.length);
		const configs = new Set(rows.map((r) => r.config));
		for (const c of REPLAY_CONFIGS) {
			expect(configs.has(c.id)).toBe(true);
		}
	});

	it("replay tokens are always ≤ original (any layer still compresses vs raw)", () => {
		const rows = replayAll([sessionPath]);
		for (const r of rows) {
			expect(r.tokensReplay).toBeLessThanOrEqual(r.tokensOriginal);
			expect(r.deltaPct).toBeLessThanOrEqual(0);
		}
	});

	it("replay-no-flint keeps MORE tokens than a hypothetical all-layers-on baseline", () => {
		// Turning off flint means the huge bash output is NOT trimmed to 80 lines —
		// so replay-no-flint should yield >= tokens than replay-no-stone (stone
		// only affects JSON; the huge bash stays compressed by flint in that config).
		const noFlint = replaySession(sessionPath, "replay-no-flint");
		const noStone = replaySession(sessionPath, "replay-no-stone");
		expect(noFlint.tokensReplay).toBeGreaterThan(noStone.tokensReplay);
	});

	it("replay-no-dedup keeps both identical reads (more tokens than other configs)", () => {
		const noDedup = replaySession(sessionPath, "replay-no-dedup");
		const noStone = replaySession(sessionPath, "replay-no-stone");
		// With dedup off, the second read is not stubbed, so tokens are higher
		// than a config where dedup still runs.
		expect(noDedup.tokensReplay).toBeGreaterThan(noStone.tokensReplay);
	});

	it("tokensOriginal is identical across all configs (same underlying data)", () => {
		const rows = replayAll([sessionPath]);
		const originals = new Set(rows.map((r) => r.tokensOriginal));
		expect(originals.size).toBe(1);
	});

	it("replayAllLayersOnBaseline returns tokens ≤ any per-layer-disabled replay", () => {
		const baseline = replayAllLayersOnBaseline(sessionPath);
		expect(baseline.tokensAllLayersOn).toBeGreaterThan(0);
		expect(baseline.tokensAllLayersOn).toBeLessThanOrEqual(baseline.tokensOriginal);
		for (const row of replayAll([sessionPath])) {
			// Disabling any single layer shouldn't compress BETTER than all-on.
			expect(row.tokensReplay).toBeGreaterThanOrEqual(baseline.tokensAllLayersOn - 1);
		}
	});

	it("replayAllWithBaseline bundles rows + per-session baselines consistently", () => {
		const { rows, baselines } = replayAllWithBaseline([sessionPath]);
		expect(baselines).toHaveLength(1);
		expect(baselines[0].sessionPath).toBe(sessionPath);
		expect(rows).toHaveLength(4);
	});
});
