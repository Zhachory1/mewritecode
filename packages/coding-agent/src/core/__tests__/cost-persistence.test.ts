/**
 * WS19: Unit tests for cost-persistence.ts
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { todayDateString, weekKeyForDate } from "../cost-formatter.js";
import {
	getAllTimeSavingsBytes,
	getCostTotalsPath,
	getThisWeekSavingsBytes,
	getThisWeekTotal,
	getTodayTotal,
	persistSessionCost,
	persistSessionSavings,
	readCostTotals,
	type SessionCostDelta,
} from "../cost-persistence.js";

let tmpDir: string;
let totalsPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cave-cost-test-"));
	totalsPath = join(tmpDir, "cost-totals.json");
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("getCostTotalsPath", () => {
	it("includes cost-totals.json filename", () => {
		const p = getCostTotalsPath("/tmp/test-cave");
		expect(p).toContain("cost-totals.json");
		expect(p).toContain("test-cave");
	});
});

describe("readCostTotals", () => {
	it("returns empty structure when file not found", () => {
		const totals = readCostTotals(join(tmpDir, "nonexistent.json"));
		expect(totals).toEqual({ daily: {}, weekly: {} });
	});

	it("returns empty structure when file is malformed JSON", () => {
		writeFileSync(totalsPath, "not-valid-json", "utf8");
		const totals = readCostTotals(totalsPath);
		expect(totals).toEqual({ daily: {}, weekly: {} });
	});

	it("reads a valid file", () => {
		const data = {
			daily: { "2026-04-28": { input: 100, output: 50, cacheCreate: 0, cacheRead: 0, dollars: 0.01 } },
			weekly: { "2026-W17": { input: 500, output: 200, cacheCreate: 0, cacheRead: 0, dollars: 0.05 } },
		};
		writeFileSync(totalsPath, JSON.stringify(data), "utf8");
		const totals = readCostTotals(totalsPath);
		expect(totals.daily["2026-04-28"]?.input).toBe(100);
		expect(totals.weekly["2026-W17"]?.dollars).toBe(0.05);
	});
});

describe("persistSessionCost", () => {
	it("creates the file when it does not exist", () => {
		const delta: SessionCostDelta = {
			inputTokens: 1000,
			outputTokens: 500,
			cacheCreateTokens: 0,
			cacheReadTokens: 100,
			dollars: 0.01,
		};
		persistSessionCost(delta, totalsPath);

		const raw = JSON.parse(readFileSync(totalsPath, "utf8"));
		const today = todayDateString();
		expect(raw.daily[today]).toBeDefined();
		expect(raw.daily[today].input).toBe(1000);
	});

	it("accumulates multiple session deltas", () => {
		const delta: SessionCostDelta = {
			inputTokens: 1000,
			outputTokens: 500,
			cacheCreateTokens: 0,
			cacheReadTokens: 0,
			dollars: 0.01,
		};
		persistSessionCost(delta, totalsPath);
		persistSessionCost(delta, totalsPath);

		const totals = readCostTotals(totalsPath);
		const today = todayDateString();
		expect(totals.daily[today]?.input).toBe(2000);
		expect(totals.daily[today]?.dollars).toBeCloseTo(0.02);
	});

	it("writes weekly aggregate alongside daily", () => {
		const delta: SessionCostDelta = {
			inputTokens: 2000,
			outputTokens: 1000,
			cacheCreateTokens: 0,
			cacheReadTokens: 0,
			dollars: 0.02,
		};
		persistSessionCost(delta, totalsPath);

		const totals = readCostTotals(totalsPath);
		const week = weekKeyForDate(todayDateString());
		expect(totals.weekly[week]).toBeDefined();
		expect(totals.weekly[week]?.input).toBe(2000);
	});

	it("atomic write: uses rename-on-write (no temp file left behind)", () => {
		const delta: SessionCostDelta = {
			inputTokens: 100,
			outputTokens: 50,
			cacheCreateTokens: 0,
			cacheReadTokens: 0,
			dollars: 0.001,
		};
		persistSessionCost(delta, totalsPath);

		// Only the final file should exist (no .tmp.* files)
		const files = readdirSync(tmpDir);
		const tmpFiles = files.filter((f) => f.includes(".tmp."));
		expect(tmpFiles).toHaveLength(0);
		expect(files).toContain("cost-totals.json");
	});

	it("skips write when delta is all-zero", () => {
		const delta: SessionCostDelta = {
			inputTokens: 0,
			outputTokens: 0,
			cacheCreateTokens: 0,
			cacheReadTokens: 0,
			dollars: 0,
		};
		persistSessionCost(delta, totalsPath);

		// File should not have been created
		let exists = false;
		try {
			readFileSync(totalsPath);
			exists = true;
		} catch {
			/* expected */
		}
		expect(exists).toBe(false);
	});
});

describe("getTodayTotal", () => {
	it("returns undefined when no data for today", () => {
		const result = getTodayTotal(totalsPath);
		expect(result).toBeUndefined();
	});

	it("returns today's total after persist", () => {
		persistSessionCost(
			{ inputTokens: 500, outputTokens: 200, cacheCreateTokens: 0, cacheReadTokens: 0, dollars: 0.005 },
			totalsPath,
		);
		const result = getTodayTotal(totalsPath);
		expect(result?.input).toBe(500);
		expect(result?.dollars).toBeCloseTo(0.005);
	});
});

describe("getThisWeekTotal", () => {
	it("returns undefined when no data for this week", () => {
		const result = getThisWeekTotal(totalsPath);
		expect(result).toBeUndefined();
	});

	it("returns week total after persist", () => {
		persistSessionCost(
			{ inputTokens: 3000, outputTokens: 1000, cacheCreateTokens: 50, cacheReadTokens: 200, dollars: 0.03 },
			totalsPath,
		);
		const result = getThisWeekTotal(totalsPath);
		expect(result?.input).toBe(3000);
		expect(result?.cacheCreate).toBe(50);
	});
});

describe("weekly rollover pruning", () => {
	it("prunes weekly entries older than 52 weeks", () => {
		// Manually write an old entry (2 years ago)
		const oldData = {
			daily: {},
			weekly: {
				"2024-W01": { input: 999, output: 111, cacheCreate: 0, cacheRead: 0, dollars: 0.99 },
			},
		};
		writeFileSync(totalsPath, JSON.stringify(oldData), "utf8");

		// Persist something new to trigger pruning
		persistSessionCost(
			{ inputTokens: 100, outputTokens: 50, cacheCreateTokens: 0, cacheReadTokens: 0, dollars: 0.001 },
			totalsPath,
		);

		const totals = readCostTotals(totalsPath);
		expect(totals.weekly["2024-W01"]).toBeUndefined();
	});
});

describe("persistSessionSavings (DD §10.7)", () => {
	it("increments daily/weekly/all-time bytes", () => {
		persistSessionSavings({ sessionId: "s1", bytes: 4096 }, totalsPath);

		const totals = readCostTotals(totalsPath);
		const today = todayDateString();
		const week = weekKeyForDate(today);
		expect(totals.savings?.daily[today]?.bytes).toBe(4096);
		expect(totals.savings?.weekly[week]?.bytes).toBe(4096);
		expect(totals.savings?.allTime.bytes).toBe(4096);
		expect(getAllTimeSavingsBytes(totalsPath)).toBe(4096);
		expect(getThisWeekSavingsBytes(totalsPath)).toBe(4096);
	});

	it("is idempotent by session id — same id twice does NOT double-add", () => {
		persistSessionSavings({ sessionId: "dupe", bytes: 1000 }, totalsPath);
		persistSessionSavings({ sessionId: "dupe", bytes: 1000 }, totalsPath);
		expect(getAllTimeSavingsBytes(totalsPath)).toBe(1000);
		expect(getThisWeekSavingsBytes(totalsPath)).toBe(1000);
	});

	it("accumulates distinct session ids", () => {
		persistSessionSavings({ sessionId: "a", bytes: 1000 }, totalsPath);
		persistSessionSavings({ sessionId: "b", bytes: 500 }, totalsPath);
		expect(getAllTimeSavingsBytes(totalsPath)).toBe(1500);
	});

	it("persists savings-only sessions (no cost gating)", () => {
		// No cost ever written; savings should still land.
		persistSessionSavings({ sessionId: "savings-only", bytes: 2048 }, totalsPath);
		expect(getAllTimeSavingsBytes(totalsPath)).toBe(2048);
	});

	it("ignores zero/negative bytes and missing session id", () => {
		persistSessionSavings({ sessionId: "z", bytes: 0 }, totalsPath);
		persistSessionSavings({ sessionId: "n", bytes: -5 }, totalsPath);
		persistSessionSavings({ sessionId: "", bytes: 100 }, totalsPath);
		expect(getAllTimeSavingsBytes(totalsPath)).toBe(0);
	});

	it("back-fills savings onto a pre-existing cost-only file without clobbering cost", () => {
		persistSessionCost(
			{ inputTokens: 1000, outputTokens: 500, cacheCreateTokens: 0, cacheReadTokens: 0, dollars: 0.02 },
			totalsPath,
		);
		persistSessionSavings({ sessionId: "mix", bytes: 4096 }, totalsPath);

		const totals = readCostTotals(totalsPath);
		const today = todayDateString();
		expect(totals.daily[today]?.dollars).toBeCloseTo(0.02, 12); // cost preserved
		expect(totals.savings?.allTime.bytes).toBe(4096);
	});

	it("read helpers return 0 on a missing/pre-savings file", () => {
		expect(getAllTimeSavingsBytes(join(tmpDir, "nope.json"))).toBe(0);
		expect(getThisWeekSavingsBytes(join(tmpDir, "nope.json"))).toBe(0);
	});
});
