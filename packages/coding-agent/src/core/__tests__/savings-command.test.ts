/**
 * Savings Meter (DD §10) — `/savings` formatter tests.
 *
 * Bytes-led headline; tokens/$ as `≈` riders; cache-reuse on its OWN line and
 * NEVER summed into product savings nor present in `--share`; honest %; zero-state.
 */

import { describe, expect, it } from "vitest";
import type { SavingsAggregate } from "../cost-persistence.js";
import type { SavingsTotals } from "../savings-tracker.js";
import { formatBytes, formatSavingsReport, formatSavingsShare, runSavingsCommand } from "../slash-commands/savings.js";

function totals(over: Partial<SavingsTotals> = {}): SavingsTotals {
	return {
		bytesSaved: 0,
		bySource: { dedup: { bytes: 0 }, compression: { bytes: 0 }, compaction: { bytes: 0 } },
		totalToolOutputBytes: 0,
		tokensSavedApprox: 0,
		dollarsSavedApprox: 0,
		cacheReuseDollars: 0,
		percentCompressed: 0,
		activationId: "test-activation",
		...over,
	};
}

describe("formatBytes", () => {
	it("formats B / KB / MB", () => {
		expect(formatBytes(940)).toBe("940 B");
		expect(formatBytes(4200)).toBe("4.1 KB");
		expect(formatBytes(1_500_000)).toBe("1.4 MB");
	});
});

describe("runSavingsCommand", () => {
	it("leads with bytes + honest %; tokens/$ are riders", () => {
		const result = runSavingsCommand({
			pricingKnown: true,
			totals: totals({
				bytesSaved: 12_288,
				bySource: { dedup: { bytes: 8192 }, compression: { bytes: 4096 }, compaction: { bytes: 0 } },
				totalToolOutputBytes: 40_960,
				tokensSavedApprox: 3072,
				dollarsSavedApprox: 0.009216,
				percentCompressed: 0.3,
			}),
		});
		const text = result.lines.join("\n");
		// Bytes lead.
		expect(result.lines[0]).toContain("Me Write Code eliminated 12.0 KB of context");
		expect(result.lines[0]).toContain("(30% of tool output)");
		// Riders.
		expect(text).toContain("≈ 3.1k tok");
		expect(text).toContain("~$");
		// dedup labeled "re-read avoided".
		expect(text).toContain("re-read avoided");
		expect(text).toContain("compression");
		// Honesty note.
		expect(text).toContain("Excludes output terseness");
	});

	it("shows cache-reuse on its OWN line, never summed into product savings", () => {
		const result = runSavingsCommand({
			pricingKnown: true,
			totals: totals({
				bytesSaved: 4096,
				bySource: { dedup: { bytes: 0 }, compression: { bytes: 4096 }, compaction: { bytes: 0 } },
				totalToolOutputBytes: 8192,
				tokensSavedApprox: 1024,
				dollarsSavedApprox: 0.003,
				cacheReuseDollars: 0.42,
				percentCompressed: 0.5,
			}),
		});
		const text = result.lines.join("\n");
		expect(text).toContain("prompt cache reuse (provider feature): ~$0.42");
		expect(text).toContain("not counted above");
		// The headline line never mentions the cache $.
		expect(result.lines[0]).not.toContain("0.42");
	});

	it("omits the $ riders when pricing is unknown", () => {
		const result = runSavingsCommand({
			pricingKnown: false,
			totals: totals({
				bytesSaved: 4096,
				bySource: { dedup: { bytes: 0 }, compression: { bytes: 4096 }, compaction: { bytes: 0 } },
				totalToolOutputBytes: 8192,
				tokensSavedApprox: 1024,
				dollarsSavedApprox: 0,
				percentCompressed: 0.5,
			}),
		});
		const text = result.lines.join("\n");
		expect(text).toContain("≈ 1.0k tok");
		expect(text).not.toContain("~$");
	});

	it("renders an honest zero-state", () => {
		const result = runSavingsCommand({ pricingKnown: true, totals: totals() });
		const text = result.lines.join("\n");
		expect(text).toContain("Me Write Code eliminated 0 B of context");
		expect(text).toContain("Measured context elimination");
	});

	it("shows cumulative when present", () => {
		const result = runSavingsCommand({
			pricingKnown: true,
			cumulativeWeekBytes: 1_048_576,
			cumulativeAllTimeBytes: 5_242_880,
			totals: totals({ bytesSaved: 1024, totalToolOutputBytes: 2048, percentCompressed: 0.5 }),
		});
		const text = result.lines.join("\n");
		expect(text).toContain("cumulative: 1.0 MB this week · 5.0 MB all-time");
	});
});

function aggregate(over: Partial<SavingsAggregate> = {}): SavingsAggregate {
	return {
		daily: {},
		weekly: {},
		allTime: { bytes: 0 },
		appliedSessionIds: [],
		...over,
	};
}

describe("formatSavingsReport", () => {
	it("renders all-time bytes with ≈ tokens and a $-estimate at the STATED rate", () => {
		// 4_000_000 bytes → 1_000_000 tokens → at $3/Mtok → $3.000
		const lines = formatSavingsReport(
			aggregate({
				allTime: { bytes: 4_000_000 },
				weekly: { "2026-W24": { bytes: 800_000 } },
				daily: { "2026-06-15": { bytes: 800_000 } },
			}),
			{ assumedRatePerMTok: 3 },
		);
		const text = lines.join("\n");
		// Bytes are the headline (durable figure). 4_000_000 B → 3.8 MB (1024-based).
		expect(text).toContain("3.8 MB");
		// ≈ tokens = bytes / 4.
		expect(text).toContain("1.0M tok");
		// $-estimate AND the stated rate, inline.
		expect(text).toContain("$3.00");
		expect(text).toContain("$3/Mtok");
	});

	it("computes the $-estimate as tokens × rate / 1e6 for a non-round rate", () => {
		// 8_000_000 bytes → 2_000_000 tokens → at $2.5/Mtok → $5.00
		const lines = formatSavingsReport(aggregate({ allTime: { bytes: 8_000_000 } }), {
			assumedRatePerMTok: 2.5,
		});
		const text = lines.join("\n");
		expect(text).toContain("$5.00");
		expect(text).toContain("$2.5/Mtok");
	});

	it("shows this-week bytes derived from the latest week key present", () => {
		const lines = formatSavingsReport(
			aggregate({
				allTime: { bytes: 2_000_000 },
				weekly: { "2026-W23": { bytes: 500_000 }, "2026-W24": { bytes: 1_500_000 } },
			}),
			{ assumedRatePerMTok: 3 },
		);
		const text = lines.join("\n");
		// Latest week (W24) is "this week". 1_500_000 B → 1.4 MB (1024-based).
		expect(text).toContain("1.4 MB");
		expect(text.toLowerCase()).toContain("this week");
	});

	it("slices to recentDays and sorts daily entries descending by date", () => {
		const lines = formatSavingsReport(
			aggregate({
				allTime: { bytes: 5000 },
				daily: {
					"2026-06-10": { bytes: 100 },
					"2026-06-11": { bytes: 200 },
					"2026-06-12": { bytes: 300 },
					"2026-06-13": { bytes: 400 },
				},
			}),
			{ assumedRatePerMTok: 3, recentDays: 2 },
		);
		const text = lines.join("\n");
		// Only the 2 most-recent days appear.
		expect(text).toContain("2026-06-13");
		expect(text).toContain("2026-06-12");
		expect(text).not.toContain("2026-06-11");
		expect(text).not.toContain("2026-06-10");
		// Descending order: 06-13 before 06-12.
		expect(text.indexOf("2026-06-13")).toBeLessThan(text.indexOf("2026-06-12"));
	});

	it("defaults to 7 recent days when recentDays is omitted", () => {
		const daily: Record<string, { bytes: number }> = {};
		for (let d = 1; d <= 10; d++) {
			daily[`2026-06-${String(d).padStart(2, "0")}`] = { bytes: d * 100 };
		}
		const lines = formatSavingsReport(aggregate({ allTime: { bytes: 9999 }, daily }), {
			assumedRatePerMTok: 3,
		});
		const dayLines = lines.filter((l) => /2026-06-\d\d/.test(l));
		expect(dayLines.length).toBe(7);
		// Most recent (06-10) present; oldest (06-01) sliced out.
		expect(lines.join("\n")).toContain("2026-06-10");
		expect(lines.join("\n")).not.toContain("2026-06-01");
	});

	it("renders an honest zero-state when the aggregate is undefined", () => {
		const lines = formatSavingsReport(undefined, { assumedRatePerMTok: 3 });
		const text = lines.join("\n").toLowerCase();
		expect(text).toContain("no cumulative savings recorded yet");
		// No fabricated $.
		expect(text).not.toContain("$");
	});

	it("renders an honest zero-state when all-time bytes are zero", () => {
		const lines = formatSavingsReport(aggregate({ allTime: { bytes: 0 } }), { assumedRatePerMTok: 3 });
		expect(lines.join("\n").toLowerCase()).toContain("no cumulative savings recorded yet");
	});

	it("includes the honesty caveats: estimate, recorded-only, what is measured/excluded, prompt-cache lever", () => {
		const text = formatSavingsReport(aggregate({ allTime: { bytes: 4_000_000 } }), {
			assumedRatePerMTok: 3,
		})
			.join("\n")
			.toLowerCase();
		// $ is an estimate; bytes/tokens are the durable figures.
		expect(text).toContain("estimate");
		expect(text).toContain("durable");
		// Only sessions where the meter recorded.
		expect(text).toContain("recorded");
		// Measures context elimination (dedup + compression + compaction).
		expect(text).toContain("dedup");
		expect(text).toContain("compression");
		expect(text).toContain("compaction");
		// Excludes output terseness + truncation.
		expect(text).toContain("terseness");
		expect(text).toContain("truncation");
		// Dominant lever is prompt-cache reuse (not captured here).
		expect(text).toContain("prompt-cache");
	});
});

describe("formatSavingsShare", () => {
	it("emits bytes + % only — no $ and no cache-reuse", () => {
		const share = formatSavingsShare(
			totals({
				bytesSaved: 12_288,
				cacheReuseDollars: 9.99,
				dollarsSavedApprox: 0.5,
				percentCompressed: 0.3,
			}),
		);
		expect(share).toContain("30%");
		expect(share).toContain("12.0 KB");
		expect(share).toContain("Me Write Code compressed");
		expect(share).not.toContain("$");
		expect(share).not.toContain("9.99");
	});
});
