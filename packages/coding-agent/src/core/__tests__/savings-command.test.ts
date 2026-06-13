/**
 * Savings Meter (DD §10) — `/savings` formatter tests.
 *
 * Bytes-led headline; tokens/$ as `≈` riders; cache-reuse on its OWN line and
 * NEVER summed into the caveman total nor present in `--share`; honest %; zero-state.
 */

import { describe, expect, it } from "vitest";
import type { SavingsTotals } from "../savings-tracker.js";
import { formatBytes, formatSavingsShare, runSavingsCommand } from "../slash-commands/savings.js";

function totals(over: Partial<SavingsTotals> = {}): SavingsTotals {
	return {
		bytesSaved: 0,
		bySource: { dedup: { bytes: 0 }, compression: { bytes: 0 }, compaction: { bytes: 0 } },
		totalToolOutputBytes: 0,
		tokensSavedApprox: 0,
		dollarsSavedApprox: 0,
		cacheReuseDollars: 0,
		percentCompressed: 0,
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
		expect(result.lines[0]).toContain("Caveman eliminated 12.0 KB of context");
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

	it("shows cache-reuse on its OWN line, never summed into the caveman total", () => {
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
		expect(text).toContain("Caveman eliminated 0 B of context");
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
		expect(share).not.toContain("$");
		expect(share).not.toContain("9.99");
	});
});
