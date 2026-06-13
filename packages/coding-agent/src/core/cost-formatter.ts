/**
 * WS19: Cost Transparency Panel — formatting helpers.
 *
 * Shared by the TUI inline display, /tokens, and /cost slash commands.
 * No side effects; pure formatting utilities.
 *
 * Buckets for /tokens breakdown:
 *   system, repomap, chat-history, files, tool-results, cave-mode-savings
 *
 * Design:
 *   - formatInlineCost(): one-liner after each assistant message
 *   - formatTokenBuckets(): /tokens breakdown
 *   - formatCostSummary(): /cost session + daily + weekly totals
 *   - If pricing is unknown (dollarsTotal === 0 and model unknown), omit $ entirely.
 */

export interface InlineCostOptions {
	/** Estimated total $ for this message. 0 means unknown/not priced. */
	dollarsTotal: number;
	/** Whether pricing is known for this model. */
	pricingKnown: boolean;
	/** Cached input tokens for this message. */
	cachedInput: number;
	/** Total input tokens (including cached). */
	inputTokens: number;
	/** Output tokens. */
	outputTokens: number;
}

/**
 * Format the inline cost line shown after each assistant message.
 *
 * Examples:
 *   $0.0042 (cached: $0.0001, tokens: 1.2k in / 0.8k out)
 *   tokens: 1.2k in / 0.8k out  (when pricing unknown)
 */
export function formatInlineCost(opts: InlineCostOptions): string {
	const { dollarsTotal, pricingKnown, cachedInput, inputTokens, outputTokens } = opts;

	const inStr = formatTokenCount(inputTokens);
	const outStr = formatTokenCount(outputTokens);
	const tokenPart = `tokens: ${inStr} in / ${outStr} out`;

	if (!pricingKnown || dollarsTotal === 0) {
		// No pricing — show tokens only, no fake $
		return tokenPart;
	}

	const totalStr = `$${dollarsTotal.toFixed(4)}`;

	if (cachedInput > 0) {
		// Estimate cached portion $ (cachedInput / inputTokens * some_fraction).
		// We don't have the exact cached rate here, so we show cached token count instead.
		const cachedStr = formatTokenCount(cachedInput);
		return `${totalStr} (cached: ${cachedStr} tokens, ${tokenPart})`;
	}

	return `${totalStr} (${tokenPart})`;
}

/**
 * Per-message cost with explicit cached $ amount when available.
 */
export interface InlineCostWithRatesOptions extends InlineCostOptions {
	/** $ attributed to cached reads. 0 if unknown. */
	dollarsCachedRead: number;
}

/**
 * Full inline format as specified in WS19:
 *   $0.0042 (cached: $0.0001, tokens: 1.2k in / 0.8k out)
 */
export function formatInlineCostWithRates(opts: InlineCostWithRatesOptions): string {
	const { dollarsTotal, pricingKnown, dollarsCachedRead, inputTokens, outputTokens } = opts;

	const inStr = formatTokenCount(inputTokens);
	const outStr = formatTokenCount(outputTokens);
	const tokenPart = `tokens: ${inStr} in / ${outStr} out`;

	if (!pricingKnown || dollarsTotal === 0) {
		return tokenPart;
	}

	const totalStr = `$${dollarsTotal.toFixed(4)}`;

	if (dollarsCachedRead > 0) {
		const cachedStr = `$${dollarsCachedRead.toFixed(4)}`;
		return `${totalStr} (cached: ${cachedStr}, ${tokenPart})`;
	}

	return `${totalStr} (${tokenPart})`;
}

export interface TokenBucket {
	name: string;
	tokens: number;
	/** Optional $ estimate for the bucket. undefined = unknown pricing. */
	dollars?: number;
}

/**
 * Format /tokens breakdown by source bucket.
 *
 * Buckets: system, repomap, chat-history, files, tool-results, cave-mode-savings
 */
export function formatTokenBuckets(buckets: TokenBucket[], totalTokens: number): string {
	const lines: string[] = ["Token breakdown by source:"];

	const maxNameLen = Math.max(...buckets.map((b) => b.name.length), 4);

	for (const b of buckets) {
		if (b.tokens === 0) continue;
		const pct = totalTokens > 0 ? ` (${Math.round((b.tokens / totalTokens) * 100)}%)` : "";
		const tokStr = formatTokenCount(b.tokens).padStart(8);
		const dolStr = b.dollars !== undefined && b.dollars > 0 ? `  $${b.dollars.toFixed(4)}` : "";
		lines.push(`  ${b.name.padEnd(maxNameLen)}  ${tokStr}${pct}${dolStr}`);
	}

	lines.push(`  ${"total".padEnd(maxNameLen)}  ${formatTokenCount(totalTokens).padStart(8)}`);

	return lines.join("\n");
}

export interface DailyTotal {
	date: string; // YYYY-MM-DD
	inputTokens: number;
	outputTokens: number;
	cacheCreateTokens: number;
	cacheReadTokens: number;
	dollars: number;
}

export interface CostSummaryOptions {
	/** Current session totals. */
	session: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		dollars: number;
		pricingKnown: boolean;
	};
	/** Today's aggregate (all sessions). */
	today?: DailyTotal;
	/** This week's aggregate (all sessions). */
	thisWeek?: DailyTotal;
}

/**
 * Format /cost output: session totals + today + this week.
 */
export function formatCostSummary(opts: CostSummaryOptions): string {
	const lines: string[] = [];

	lines.push("Cost summary");
	lines.push("");

	// Session
	lines.push("  Session");
	lines.push(`    Input:       ${formatTokenCount(opts.session.inputTokens)} tokens`);
	lines.push(`    Output:      ${formatTokenCount(opts.session.outputTokens)} tokens`);
	if (opts.session.cacheReadTokens > 0) {
		lines.push(`    Cache read:  ${formatTokenCount(opts.session.cacheReadTokens)} tokens`);
	}
	if (opts.session.cacheWriteTokens > 0) {
		lines.push(`    Cache write: ${formatTokenCount(opts.session.cacheWriteTokens)} tokens`);
	}
	if (opts.session.pricingKnown && opts.session.dollars > 0) {
		lines.push(`    Cost:        $${opts.session.dollars.toFixed(4)}`);
	} else if (!opts.session.pricingKnown) {
		lines.push(`    Cost:        (model not priced — tokens only)`);
	}

	// Today
	if (opts.today && (opts.today.inputTokens > 0 || opts.today.dollars > 0)) {
		lines.push("");
		lines.push(`  Today (${opts.today.date})`);
		lines.push(`    Tokens in:   ${formatTokenCount(opts.today.inputTokens)}`);
		lines.push(`    Tokens out:  ${formatTokenCount(opts.today.outputTokens)}`);
		if (opts.today.dollars > 0) {
			lines.push(`    Cost:        $${opts.today.dollars.toFixed(4)}`);
		}
	}

	// This week
	if (opts.thisWeek && (opts.thisWeek.inputTokens > 0 || opts.thisWeek.dollars > 0)) {
		lines.push("");
		lines.push("  This week");
		lines.push(`    Tokens in:   ${formatTokenCount(opts.thisWeek.inputTokens)}`);
		lines.push(`    Tokens out:  ${formatTokenCount(opts.thisWeek.outputTokens)}`);
		if (opts.thisWeek.dollars > 0) {
			lines.push(`    Cost:        $${opts.thisWeek.dollars.toFixed(4)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format a session-end summary line for printing on exit.
 * Example: "Session cost: $0.0123 (5.4k in / 2.1k out)"
 */
export function formatSessionEndSummary(opts: {
	inputTokens: number;
	outputTokens: number;
	dollars: number;
	pricingKnown: boolean;
}): string {
	const { inputTokens, outputTokens, dollars, pricingKnown } = opts;
	const inStr = formatTokenCount(inputTokens);
	const outStr = formatTokenCount(outputTokens);
	if (!pricingKnown || dollars === 0) {
		return `Session tokens: ${inStr} in / ${outStr} out`;
	}
	return `Session cost: $${dollars.toFixed(4)} (${inStr} in / ${outStr} out)`;
}

/**
 * Savings Meter (DD §10.8): session-end savings line. Bytes-led, with the
 * honest % of tool output and the cumulative all-time bytes. Returns undefined
 * when nothing was saved (the line is omitted on exit).
 *
 * Example: "Caveman eliminated 5.3 KB of context (31% of tool output) · 1.9 MB all-time"
 */
export function formatSavingsLine(opts: {
	bytesSaved: number;
	percentCompressed: number;
	cumulativeAllTimeBytes: number;
}): string | undefined {
	if (opts.bytesSaved <= 0) return undefined;
	const pct = Math.round(opts.percentCompressed * 100);
	const allTime = opts.cumulativeAllTimeBytes > 0 ? ` · ${formatByteCount(opts.cumulativeAllTimeBytes)} all-time` : "";
	return `Caveman eliminated ${formatByteCount(opts.bytesSaved)} of context (${pct}% of tool output)${allTime}`;
}

/** Compact byte count: 940 → "940 B", 4200 → "4.1 KB", 1_500_000 → "1.4 MB". */
export function formatByteCount(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compact token count: 800 → "0.8k", 1200 → "1.2k", 1_500_000 → "1.5M"
 *
 * Uses k suffix for values >= 100 to match WS19 spec (1.2k in / 0.8k out).
 */
export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 100) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/**
 * Get today's date string in YYYY-MM-DD format (local time).
 */
export function todayDateString(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/**
 * Get the ISO week key for a date string (YYYY-Www).
 * Week starts on Monday per ISO 8601.
 */
export function weekKeyForDate(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	// Copy date so don't modify original
	const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	// Set to nearest Thursday: current date + 4 - current day number (Mon=1 ... Sun=7)
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
	return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
