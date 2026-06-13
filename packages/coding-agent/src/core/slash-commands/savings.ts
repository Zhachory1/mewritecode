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
