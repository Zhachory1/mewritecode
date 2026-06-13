/**
 * Savings Meter — session-scoped SavingsTracker (DD §10.6).
 *
 * Bytes-led. Tracks context BYTES eliminated by Caveman compression, leading
 * with the exact byte figure; tokens (`≈ bytes/4`) and `$` (`≈ tokens × input
 * rate`) are clearly-secondary `≈` riders.
 *
 * Three clean, disjoint sources (DD §10.2): `dedup` | `compression` | `compaction`.
 *   - dedup       — re-read replaced by a stub (early-return path). Labeled
 *                   "re-read avoided" — the fingerprint is heuristic, so we do
 *                   NOT claim absolute elimination-certainty.
 *   - compression — net delta of the whole afterToolCall cave pipeline, per result.
 *   - compaction  — soft-compaction per-message text reduction.
 *
 * Honest denominator (DD §10.4): `totalToolOutputBytes` = Σ bytes of EVERY tool
 * result the model received (compressed or not). `percentCompressed` =
 * bytesSaved / totalToolOutputBytes.
 *
 * Cache-reuse (DD §10.5) is provider-level, derived-on-read elsewhere, and
 * NEVER summed into the caveman total. The tracker carries it ONLY as a
 * separate `cacheReuseDollars` field set by the caller; it is excluded from
 * `bytesSaved`, `tokensSavedApprox`, and `dollarsSavedApprox`.
 *
 * Mechanism split (DD §10.6): compression/dedup/compaction are
 * EVENT-accumulated bytes (the original bytes aren't retained post-compression);
 * cache-reuse is DERIVED-on-read from the message list (idempotent). Owned by
 * AgentSession, fresh per session (session reset = dispose + recreate).
 */

/** Caveman headline sources (collapsed per DD §10.2). */
export type SavingsSource = "dedup" | "compression" | "compaction";

export interface SavingsTotals {
	/** Exact bytes of context eliminated by Caveman (headline noun). */
	bytesSaved: number;
	/** Per-source byte subtotals. */
	bySource: Record<SavingsSource, { bytes: number }>;
	/** Denominator: bytes of EVERY tool result the model received. */
	totalToolOutputBytes: number;
	/** ≈ bytesSaved/4 (secondary rider; chars/4 over-counts dense output). */
	tokensSavedApprox: number;
	/** ≈ tokensSavedApprox × current input rate (secondary rider). */
	dollarsSavedApprox: number;
	/** Provider prompt-cache reuse $ — SEPARATE, never in the caveman total. */
	cacheReuseDollars: number;
	/** bytesSaved / totalToolOutputBytes, /0-guarded. */
	percentCompressed: number;
}

function emptyBySource(): Record<SavingsSource, { bytes: number }> {
	return {
		dedup: { bytes: 0 },
		compression: { bytes: 0 },
		compaction: { bytes: 0 },
	};
}

export class SavingsTracker {
	private _bytesSaved = 0;
	private _bySource = emptyBySource();
	private _totalToolOutputBytes = 0;
	/** Set by the caller (derived-on-read from the message list); not accumulated. */
	private _cacheReuseDollars = 0;

	/**
	 * Record that the model received a tool result of `totalBytes` (the
	 * denominator). Call once per tool result — compressed or not.
	 */
	recordToolOutput(totalBytes: number): void {
		if (!Number.isFinite(totalBytes) || totalBytes <= 0) return;
		this._totalToolOutputBytes += totalBytes;
	}

	/**
	 * Record `savedBytes` of context elimination attributed to `source`. Booked
	 * once per event. Negative deltas (compression made it bigger) clamp to 0.
	 */
	recordSaving(source: SavingsSource, savedBytes: number): void {
		if (!Number.isFinite(savedBytes)) return;
		const saved = Math.max(0, savedBytes);
		if (saved === 0) return;
		this._bytesSaved += saved;
		this._bySource[source].bytes += saved;
	}

	/**
	 * Set the SEPARATE provider cache-reuse $ (derived-on-read by the caller).
	 * NEVER folded into the caveman bytes/tokens/$ total.
	 */
	setCacheReuseDollars(dollars: number): void {
		this._cacheReuseDollars = Number.isFinite(dollars) && dollars > 0 ? dollars : 0;
	}

	/** bytesSaved / totalToolOutputBytes, /0-guarded → 0. */
	percentCompressed(): number {
		if (this._totalToolOutputBytes <= 0) return 0;
		// Clamp to [0,1]: compaction adds to the numerator (bytesSaved) but not the
		// denominator (a second pass over already-counted output), so the raw ratio
		// can exceed 1 on heavy compaction — never display >100%.
		return Math.min(1, this._bytesSaved / this._totalToolOutputBytes);
	}

	/**
	 * Snapshot. `inputRatePerMTok` ($/million tokens) prices the `≈$` rider; the
	 * tracker stays pricing-free for bytes/tokens. Pass 0 for unknown pricing →
	 * `dollarsSavedApprox` is 0.
	 */
	totals(inputRatePerMTok = 0): SavingsTotals {
		const tokensSavedApprox = Math.round(this._bytesSaved / 4);
		const rate = Number.isFinite(inputRatePerMTok) && inputRatePerMTok > 0 ? inputRatePerMTok : 0;
		const dollarsSavedApprox = (tokensSavedApprox * rate) / 1e6;
		return {
			bytesSaved: this._bytesSaved,
			bySource: {
				dedup: { bytes: this._bySource.dedup.bytes },
				compression: { bytes: this._bySource.compression.bytes },
				compaction: { bytes: this._bySource.compaction.bytes },
			},
			totalToolOutputBytes: this._totalToolOutputBytes,
			tokensSavedApprox,
			dollarsSavedApprox,
			cacheReuseDollars: this._cacheReuseDollars,
			percentCompressed: this.percentCompressed(),
		};
	}

	/** Reset all event-accumulated state. (Session reset normally recreates the instance.) */
	reset(): void {
		this._bytesSaved = 0;
		this._bySource = emptyBySource();
		this._totalToolOutputBytes = 0;
		this._cacheReuseDollars = 0;
	}
}
