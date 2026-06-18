/**
 * Pure evaluation logic for the context-drift early warnings rendered in
 * interactive mode (issue #16 stage 3).
 *
 * Two independent heuristics share the same input — a context-usage snapshot
 * from AgentSession — and decide whether to surface a widget/status and/or
 * trigger a preemptive compaction:
 *
 *   - **Tribal Signal**: rolling-token-count heuristic that flips between
 *     muted / amber-status / red-widget / "burning fast" rate warning as
 *     context fills.
 *   - **Fire Starter**: rate-projection heuristic that asks "based on the
 *     average burn over recent turns, how many turns until I'm full?" and
 *     compacts preemptively when that projection is under N turns.
 *
 * Everything here is a pure function over snapshot state — no I/O, no
 * `this`, no timers. The caller owns the state objects and applies the
 * returned side-effects (set widget / status / fire compaction).
 */

/** Snapshot of context usage, mirroring `AgentSession.getContextUsage()`. */
export interface ContextUsageSnapshot {
	tokens: number | null;
	percent: number | null;
	contextWindow: number;
}

// =============================================================================
// Tribal Signal
// =============================================================================

export interface TribalSignalState {
	/** Whether the amber footer status has fired since the last reset. */
	amberFired: boolean;
	/** Rolling window of token totals for the most recent turns (max 5). */
	recentTurnTokens: number[];
}

export function emptyTribalSignalState(): TribalSignalState {
	return { amberFired: false, recentTurnTokens: [] };
}

export type TribalSignalEffect =
	| { kind: "clear" }
	| { kind: "rateWarning"; message: string }
	| { kind: "red"; message: string; pct: number }
	| { kind: "amber"; pct: number }
	| { kind: "amberClear" };

export interface TribalSignalDecision {
	nextState: TribalSignalState;
	effect: TribalSignalEffect;
}

/**
 * Evaluate the Tribal Signal heuristic against the current context-usage
 * snapshot and prior state. Returns the next state plus a single effect the
 * caller renders.
 *
 * Thresholds (preserved verbatim from the inline implementation):
 *   - < 60%      → clear all surfaces, reset `amberFired`
 *   - 3 consecutive turns each >= 1.5x previous → rate-warning widget
 *   - >= 85%     → red widget
 *   - >= 70%     → amber footer status (one-shot until reset)
 */
export function evaluateTribalSignal(
	usage: ContextUsageSnapshot | null | undefined,
	prev: TribalSignalState,
): TribalSignalDecision {
	// Below the noise floor — clear surfaces and reset state.
	if (!usage || usage.percent === null || usage.percent < 60) {
		return {
			nextState: { amberFired: false, recentTurnTokens: prev.recentTurnTokens },
			effect: { kind: "clear" },
		};
	}

	const pct = usage.percent;

	// Track recent turn tokens for rate detection (rolling window of 5).
	const recentTurnTokens = [...prev.recentTurnTokens];
	if (usage.tokens !== null) {
		recentTurnTokens.push(usage.tokens);
		if (recentTurnTokens.length > 5) recentTurnTokens.shift();
	}

	// Rate warning: 3 consecutive turns each >= 1.5x previous.
	if (recentTurnTokens.length >= 3) {
		const recent = recentTurnTokens.slice(-3);
		const accelerating = recent[1]! >= recent[0]! * 1.5 && recent[2]! >= recent[1]! * 1.5;
		if (accelerating) {
			return {
				nextState: { amberFired: prev.amberFired, recentTurnTokens },
				effect: { kind: "rateWarning", message: "Context burning fast. Rate accelerating. Consider /compact" },
			};
		}
	}

	// Red widget at 85%+.
	if (pct >= 85) {
		return {
			nextState: { amberFired: true, recentTurnTokens },
			effect: {
				kind: "red",
				message: `Context ${Math.round(pct)}% full. Consider /compact or /freeze`,
				pct,
			},
		};
	}

	// Amber footer status at 70%+, fire once until reset.
	if (pct >= 70 && !prev.amberFired) {
		return {
			nextState: { amberFired: true, recentTurnTokens },
			effect: { kind: "amber", pct },
		};
	}

	if (pct < 70) {
		return {
			nextState: { amberFired: false, recentTurnTokens },
			effect: { kind: "amberClear" },
		};
	}

	// Already amber, no level change.
	return {
		nextState: { amberFired: prev.amberFired, recentTurnTokens },
		effect: { kind: "amberClear" },
	};
}

// =============================================================================
// Fire Starter (preemptive compaction)
// =============================================================================

export interface FireStarterState {
	/** Rolling window of token totals for the most recent turns (max 6). */
	turnDeltas: number[];
	/** Timestamp of the last preemptive compaction (Date.now()). */
	lastCompactionTime: number;
}

export function emptyFireStarterState(): FireStarterState {
	return { turnDeltas: [], lastCompactionTime: 0 };
}

export interface FireStarterThresholds {
	minGapMs: number;
	turnsAhead: number;
	minFillPct: number;
}

export const DEFAULT_FIRE_STARTER_THRESHOLDS: FireStarterThresholds = {
	minGapMs: 60_000,
	turnsAhead: 3,
	minFillPct: 55,
};

export interface FireStarterDecision {
	nextState: FireStarterState;
	/** True iff the caller should fire `session.compact(...)`. */
	shouldCompact: boolean;
}

/**
 * Decide whether to preemptively compact based on the rolling burn rate.
 *
 * The caller passes the current usage snapshot, prior state, a wall-clock
 * `now`, and a flag indicating whether compaction is already in flight (we
 * skip in that case to avoid stacking).
 *
 * Pure: no I/O. The caller fires `session.compact()` on `shouldCompact: true`
 * and stores `nextState` for the next call.
 */
export function evaluateFireStarter(
	usage: ContextUsageSnapshot | null | undefined,
	prev: FireStarterState,
	now: number,
	isCompacting: boolean,
	thresholds: FireStarterThresholds = DEFAULT_FIRE_STARTER_THRESHOLDS,
): FireStarterDecision {
	if (!usage || usage.percent === null || usage.tokens === null) {
		return { nextState: prev, shouldCompact: false };
	}

	const turnDeltas = [...prev.turnDeltas, usage.tokens];
	if (turnDeltas.length > 6) turnDeltas.shift();

	const nextStateBase: FireStarterState = {
		turnDeltas,
		lastCompactionTime: prev.lastCompactionTime,
	};

	if (turnDeltas.length < 3) return { nextState: nextStateBase, shouldCompact: false };
	if (usage.percent < thresholds.minFillPct) return { nextState: nextStateBase, shouldCompact: false };
	if (now - prev.lastCompactionTime < thresholds.minGapMs) return { nextState: nextStateBase, shouldCompact: false };
	if (isCompacting) return { nextState: nextStateBase, shouldCompact: false };

	// Average delta per turn from the rolling window.
	let totalDelta = 0;
	for (let i = 1; i < turnDeltas.length; i++) {
		totalDelta += turnDeltas[i]! - turnDeltas[i - 1]!;
	}
	const avgDeltaPerTurn = totalDelta / (turnDeltas.length - 1);

	// Only trigger on positive burn rate (context growing).
	if (avgDeltaPerTurn <= 0) return { nextState: nextStateBase, shouldCompact: false };

	const remainingTokens = usage.contextWindow - usage.tokens;
	const projectedTurnsToFull = remainingTokens / avgDeltaPerTurn;

	if (projectedTurnsToFull < thresholds.turnsAhead) {
		return {
			nextState: { turnDeltas, lastCompactionTime: now },
			shouldCompact: true,
		};
	}

	return { nextState: nextStateBase, shouldCompact: false };
}
