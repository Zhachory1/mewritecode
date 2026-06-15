/**
 * Savings Meter (DD §10) — `/savings` pure formatter.
 *
 * LEADS WITH BYTES (exact). Tokens (`≈ bytes/4`) and `$` (`≈ tokens × input
 * rate`) are secondary `≈` riders — bytes are the headline, NOT chars/4.
 *
 * The honest denominator is `bytesSaved / totalToolOutputBytes` (ALL tool
 * results, not just compressed). Prompt-cache reuse is shown on its OWN line,
 * labeled "(provider feature)", and is NEVER summed into the caveman total nor
 * emitted in `--share`. Dedup is labeled "re-read avoided" (its fingerprint is
 * heuristic — we do not claim absolute elimination-certainty).
 */

import { formatByteCount } from "../cost-formatter.js";
import type { SavingsAggregate } from "../cost-persistence.js";
import type { SavingsTotals } from "../savings-tracker.js";

export interface SavingsCommandContext {
	/** Session savings totals (priced at the current model input rate). */
	totals: SavingsTotals;
	/** Whether the current model has known pricing (gates the `~$` riders). */
	pricingKnown: boolean;
	/** Cumulative all-time savings bytes (from cost-totals.json). */
	cumulativeAllTimeBytes?: number;
	/** Cumulative this-week savings bytes (from cost-totals.json). */
	cumulativeWeekBytes?: number;
}

export interface SavingsCommandResult {
	lines: string[];
	errors: number;
}

/** Format a byte count: 940 → "940 B", 4200 → "4.1 KB", 1_500_000 → "1.4 MB". */
export const formatBytes = formatByteCount;

/** Compact token count: 800 → "0.8k", 1200 → "1.2k", 1_500_000 → "1.5M". */
function formatApproxTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function formatDollars(n: number): string {
	return `$${n.toFixed(n < 0.01 ? 4 : 3)}`;
}

const SOURCE_LABELS: Record<string, string> = {
	dedup: "re-read avoided",
	compression: "compression",
	compaction: "compaction",
};

/**
 * Render `/savings`. Pure — no side effects.
 *
 * Zero-state (no bytes saved) still renders an honest header plus the provider
 * cache-reuse line when present.
 */
export function runSavingsCommand(ctx: SavingsCommandContext): SavingsCommandResult {
	const { totals, pricingKnown } = ctx;
	const lines: string[] = [];

	const pct = Math.round(totals.percentCompressed * 100);

	if (totals.bytesSaved <= 0) {
		lines.push("Caveman eliminated 0 B of context this session.");
	} else {
		// Headline: bytes (exact) + honest % of ALL tool output.
		const tokRider = `≈ ${formatApproxTokens(totals.tokensSavedApprox)} tok`;
		const dollarRider =
			pricingKnown && totals.dollarsSavedApprox > 0 ? ` · ~${formatDollars(totals.dollarsSavedApprox)}` : "";
		lines.push(`Caveman eliminated ${formatBytes(totals.bytesSaved)} of context (${pct}% of tool output)`);
		lines.push(`  ${tokRider}${dollarRider}`);

		// Per-source breakdown (bytes-led).
		for (const source of ["dedup", "compression", "compaction"] as const) {
			const bytes = totals.bySource[source].bytes;
			if (bytes <= 0) continue;
			lines.push(`    ${SOURCE_LABELS[source].padEnd(16)} ${formatBytes(bytes)}`);
		}
	}

	// Prompt-cache reuse — SEPARATE, never in the caveman total.
	if (totals.cacheReuseDollars > 0) {
		lines.push(
			`prompt cache reuse (provider feature): ~${formatDollars(totals.cacheReuseDollars)} (not counted above)`,
		);
	}

	// Cumulative (durable, shareable figure).
	const week = ctx.cumulativeWeekBytes ?? 0;
	const allTime = ctx.cumulativeAllTimeBytes ?? 0;
	if (week > 0 || allTime > 0) {
		lines.push(`cumulative: ${formatBytes(week)} this week · ${formatBytes(allTime)} all-time`);
	}

	// Honesty note.
	lines.push("Measured context elimination (dedup + compression + compaction).");
	lines.push("Excludes output terseness (no baseline) and truncation (deferred to temp file).");

	return { lines, errors: 0 };
}

export interface SavingsReportOptions {
	/**
	 * Assumed blended input rate ($/Mtok) used ONLY to derive the headline $
	 * estimate. Stated inline so the reader knows the number is an assumption,
	 * not a measured charge.
	 */
	assumedRatePerMTok: number;
	/** How many recent daily entries to show (most-recent first). Default 7. */
	recentDays?: number;
}

/** Approx tokens from bytes: caveman bytes / 4 (same heuristic as the meter). */
function approxTokensFromBytes(bytes: number): number {
	return Math.round(bytes / 4);
}

/** Estimated $ for a token count at an assumed $/Mtok rate. */
function estimateDollars(tokens: number, ratePerMTok: number): number {
	return (tokens * ratePerMTok) / 1_000_000;
}

/** Render a rate ($/Mtok) without trailing zeros: 3 → "$3", 2.5 → "$2.5". */
function formatRate(ratePerMTok: number): string {
	return `$${Number(ratePerMTok.toFixed(2))}/Mtok`;
}

/**
 * `/savings --report` — cumulative, real-usage readout of the ALREADY-PERSISTED
 * savings aggregate (`~/.cave/cost-totals.json`). PURE: no I/O, no clock. The
 * caller supplies the aggregate and `recentDays`; "this week" is derived from
 * the latest week key PRESENT in the data, never from `Date.now()`.
 *
 * HONEST by construction: BYTES (and `≈ tokens = bytes/4`) are the durable,
 * rate-free figures and lead. The `$` is an ESTIMATE at the assumed blended
 * input rate, with the rate STATED inline. The dominant real cost lever —
 * prompt-cache reuse (#40) — is NOT captured here and is called out.
 */
export function formatSavingsReport(savings: SavingsAggregate | undefined, opts: SavingsReportOptions): string[] {
	const allTimeBytes = savings?.allTime.bytes ?? 0;
	if (!savings || allTimeBytes <= 0) {
		return [
			"No cumulative savings recorded yet.",
			"  The meter records context Caveman eliminated across real sessions;",
			"  run some work and the all-time bytes will accrue here.",
		];
	}

	const recentDays = opts.recentDays ?? 7;
	const lines: string[] = [];

	// Headline: ALL-TIME bytes (durable) + ≈ tokens + ~$ estimate at stated rate.
	const allTimeTokens = approxTokensFromBytes(allTimeBytes);
	const allTimeDollars = estimateDollars(allTimeTokens, opts.assumedRatePerMTok);
	lines.push("Cumulative caveman context eliminated (durable figure = bytes):");
	lines.push(
		`  all-time: ${formatBytes(allTimeBytes)} · ≈ ${formatApproxTokens(allTimeTokens)} tok · ` +
			`~${formatDollars(allTimeDollars)} at ~${formatRate(opts.assumedRatePerMTok)} input`,
	);

	// THIS WEEK — derived from the latest week key present (no clock).
	const weekKeys = Object.keys(savings.weekly).sort();
	const latestWeek = weekKeys.length > 0 ? weekKeys[weekKeys.length - 1] : undefined;
	if (latestWeek) {
		const weekBytes = savings.weekly[latestWeek]?.bytes ?? 0;
		const weekTokens = approxTokensFromBytes(weekBytes);
		lines.push(`  this week (${latestWeek}): ${formatBytes(weekBytes)} · ≈ ${formatApproxTokens(weekTokens)} tok`);
	}

	// Recent daily breakdown — last `recentDays` entries, most-recent first.
	const recentDailyKeys = Object.keys(savings.daily).sort().reverse().slice(0, Math.max(0, recentDays));
	if (recentDailyKeys.length > 0) {
		lines.push(`  recent (last ${recentDailyKeys.length}d):`);
		for (const key of recentDailyKeys) {
			lines.push(`    ${key}: ${formatBytes(savings.daily[key]?.bytes ?? 0)}`);
		}
	}

	// Honest caveats — the $ is an estimate; bytes/tokens are durable.
	lines.push("Notes (honesty):");
	lines.push("  • The $ is an ESTIMATE at an assumed blended input rate; bytes/tokens are the");
	lines.push("    durable, rate-free figures.");
	lines.push("  • Reflects only sessions where the meter recorded (not your entire history).");
	lines.push("  • Measures context elimination (dedup + compression + compaction).");
	lines.push("  • EXCLUDES output terseness (no baseline) and truncation (deferred to temp file).");
	lines.push("  • The dominant real cost lever is prompt-cache reuse (#40), NOT captured here.");

	return lines;
}

/**
 * `--share` one-liner: bytes + % only. No `$`, no cache-reuse (DD §10.8). The
 * percentage is the part that travels.
 */
export function formatSavingsShare(totals: SavingsTotals): string {
	const pct = Math.round(totals.percentCompressed * 100);
	return `🪨 Caveman compressed ${pct}% of my tool context this session (${formatBytes(
		totals.bytesSaved,
	)} eliminated). caveman-code`;
}
