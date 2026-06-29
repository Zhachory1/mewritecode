/**
 * WS19: Unit tests for cost-formatter.ts
 */

import { describe, expect, it } from "vitest";
import {
	formatByteCount,
	formatCostSummary,
	formatInlineCost,
	formatInlineCostWithRates,
	formatSavingsLine,
	formatSessionEndSummary,
	formatTokenBuckets,
	formatTokenCount,
	todayDateString,
	weekKeyForDate,
} from "../cost-formatter.js";

describe("formatTokenCount", () => {
	it("formats very small counts as-is", () => {
		expect(formatTokenCount(0)).toBe("0");
		expect(formatTokenCount(99)).toBe("99");
	});

	it("formats hundreds and thousands with k suffix", () => {
		expect(formatTokenCount(100)).toBe("0.1k");
		expect(formatTokenCount(800)).toBe("0.8k");
		expect(formatTokenCount(1000)).toBe("1.0k");
		expect(formatTokenCount(1200)).toBe("1.2k");
		expect(formatTokenCount(999_900)).toBe("999.9k");
	});

	it("formats millions with M suffix", () => {
		expect(formatTokenCount(1_000_000)).toBe("1.0M");
		expect(formatTokenCount(1_500_000)).toBe("1.5M");
	});
});

describe("formatInlineCost", () => {
	it("returns token-only string when pricing unknown", () => {
		const result = formatInlineCost({
			dollarsTotal: 0,
			pricingKnown: false,
			cachedInput: 0,
			inputTokens: 1200,
			outputTokens: 800,
		});
		expect(result).toBe("tokens: 1.2k in / 0.8k out");
		expect(result).not.toContain("$");
	});

	it("returns token-only string when pricingKnown=true but dollars=0", () => {
		const result = formatInlineCost({
			dollarsTotal: 0,
			pricingKnown: true,
			cachedInput: 0,
			inputTokens: 1000,
			outputTokens: 500,
		});
		// dollarsTotal 0 means nothing to show
		expect(result).toContain("tokens:");
		expect(result).not.toContain("$");
	});

	it("includes dollar amount when pricing known and cost > 0", () => {
		const result = formatInlineCost({
			dollarsTotal: 0.0042,
			pricingKnown: true,
			cachedInput: 0,
			inputTokens: 1200,
			outputTokens: 800,
		});
		expect(result).toContain("$0.0042");
		expect(result).toContain("tokens: 1.2k in / 0.8k out");
	});

	it("mentions cached tokens when cache hit present", () => {
		const result = formatInlineCost({
			dollarsTotal: 0.0042,
			pricingKnown: true,
			cachedInput: 500,
			inputTokens: 1200,
			outputTokens: 800,
		});
		expect(result).toContain("cached:");
		expect(result).toContain("0.5k tokens");
	});
});

describe("formatInlineCostWithRates", () => {
	it("shows cached $ amount when available", () => {
		const result = formatInlineCostWithRates({
			dollarsTotal: 0.0042,
			pricingKnown: true,
			dollarsCachedRead: 0.0001,
			cachedInput: 500,
			inputTokens: 1200,
			outputTokens: 800,
		});
		expect(result).toBe("$0.0042 (cached: $0.0001, tokens: 1.2k in / 0.8k out)");
	});

	it("omits cached $ when zero", () => {
		const result = formatInlineCostWithRates({
			dollarsTotal: 0.0042,
			pricingKnown: true,
			dollarsCachedRead: 0,
			cachedInput: 0,
			inputTokens: 1200,
			outputTokens: 800,
		});
		expect(result).toBe("$0.0042 (tokens: 1.2k in / 0.8k out)");
	});

	it("returns tokens-only string when pricing unknown — no fake $", () => {
		const result = formatInlineCostWithRates({
			dollarsTotal: 0,
			pricingKnown: false,
			dollarsCachedRead: 0,
			cachedInput: 0,
			inputTokens: 1500,
			outputTokens: 2000,
		});
		expect(result).toBe("tokens: 1.5k in / 2.0k out");
		expect(result).not.toContain("$");
	});
});

describe("formatTokenBuckets", () => {
	it("renders bucket table", () => {
		const buckets = [
			{ name: "system", tokens: 2000 },
			{ name: "chat-history", tokens: 5000 },
			{ name: "tool-results", tokens: 1000 },
		];
		const result = formatTokenBuckets(buckets, 8000);
		expect(result).toContain("system");
		expect(result).toContain("chat-history");
		expect(result).toContain("tool-results");
		expect(result).toContain("total");
	});

	it("skips zero-token buckets", () => {
		const buckets = [
			{ name: "system", tokens: 1000 },
			{ name: "repomap", tokens: 0 },
		];
		const result = formatTokenBuckets(buckets, 1000);
		expect(result).toContain("system");
		expect(result).not.toContain("repomap");
	});

	it("shows percentage of total", () => {
		const buckets = [{ name: "chat-history", tokens: 500 }];
		const result = formatTokenBuckets(buckets, 1000);
		expect(result).toContain("50%");
	});
});

describe("formatCostSummary", () => {
	it("renders session totals", () => {
		const result = formatCostSummary({
			session: {
				inputTokens: 5000,
				outputTokens: 2000,
				cacheReadTokens: 1000,
				cacheWriteTokens: 0,
				dollars: 0.0123,
				pricingKnown: true,
			},
		});
		expect(result).toContain("Session");
		expect(result).toContain("5.0k");
		expect(result).toContain("$0.0123");
	});

	it("shows pricing unavailable message when not priced", () => {
		const result = formatCostSummary({
			session: {
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				dollars: 0,
				pricingKnown: false,
			},
		});
		expect(result).toContain("not priced");
		expect(result).not.toMatch(/\$\d/); // no dollar amounts
	});

	it("includes today and this week when provided", () => {
		const result = formatCostSummary({
			session: {
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				dollars: 0.005,
				pricingKnown: true,
			},
			today: {
				date: "2026-04-28",
				inputTokens: 12000,
				outputTokens: 4000,
				cacheCreateTokens: 0,
				cacheReadTokens: 0,
				dollars: 0.045,
			},
			thisWeek: {
				date: "this week",
				inputTokens: 45000,
				outputTokens: 18000,
				cacheCreateTokens: 0,
				cacheReadTokens: 0,
				dollars: 0.123,
			},
		});
		expect(result).toContain("2026-04-28");
		expect(result).toContain("This week");
		expect(result).toContain("$0.1230");
	});
});

describe("formatSessionEndSummary", () => {
	it("formats with $ when pricing known", () => {
		const result = formatSessionEndSummary({
			inputTokens: 5400,
			outputTokens: 2100,
			dollars: 0.0123,
			pricingKnown: true,
		});
		expect(result).toContain("$0.0123");
		expect(result).toContain("5.4k in");
		expect(result).toContain("2.1k out");
	});

	it("formats tokens-only when pricing unknown", () => {
		const result = formatSessionEndSummary({
			inputTokens: 5400,
			outputTokens: 2100,
			dollars: 0,
			pricingKnown: false,
		});
		expect(result).not.toContain("$");
		expect(result).toContain("5.4k in");
	});
});

describe("todayDateString", () => {
	it("returns YYYY-MM-DD format", () => {
		const result = todayDateString();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("weekKeyForDate", () => {
	it("returns YYYY-Www format", () => {
		const result = weekKeyForDate("2026-04-28");
		expect(result).toMatch(/^\d{4}-W\d{2}$/);
	});

	it("returns consistent week for dates in same week", () => {
		// 2026-04-27 (Mon) and 2026-04-28 (Tue) are in the same ISO week
		expect(weekKeyForDate("2026-04-27")).toBe(weekKeyForDate("2026-04-28"));
	});

	it("assigns different week keys to dates in different weeks", () => {
		// 2026-04-26 (Sun) is in week 17; 2026-04-27 (Mon) starts week 18
		const week26 = weekKeyForDate("2026-04-26");
		const week27 = weekKeyForDate("2026-04-27");
		expect(week26).not.toBe(week27);
	});
});

describe("formatByteCount", () => {
	it("formats B / KB / MB", () => {
		expect(formatByteCount(940)).toBe("940 B");
		expect(formatByteCount(4200)).toBe("4.1 KB");
		expect(formatByteCount(1_500_000)).toBe("1.4 MB");
	});
});

describe("formatSavingsLine (DD §10.8)", () => {
	it("leads with bytes + % + all-time when bytes were saved", () => {
		const line = formatSavingsLine({ bytesSaved: 5427, percentCompressed: 0.31, cumulativeAllTimeBytes: 1_992_294 });
		expect(line).toBe("Me Write Code eliminated 5.3 KB of context (31% of tool output) · 1.9 MB all-time");
	});

	it("omits the all-time suffix when cumulative is 0", () => {
		const line = formatSavingsLine({ bytesSaved: 5427, percentCompressed: 0.31, cumulativeAllTimeBytes: 0 });
		expect(line).toBe("Me Write Code eliminated 5.3 KB of context (31% of tool output)");
	});

	it("returns undefined when nothing was saved (line omitted on exit)", () => {
		expect(formatSavingsLine({ bytesSaved: 0, percentCompressed: 0, cumulativeAllTimeBytes: 100 })).toBeUndefined();
	});
});
