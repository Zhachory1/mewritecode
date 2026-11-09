/**
 * RelevanceGate — skip a context injection (repomap, memory-recall) when its
 * relevance score is below the recent p75 for that signal.
 *
 * Collects a rolling sample of scores per turn. Until `minSamples` scores
 * have been seen there's no baseline to compare against, so every call
 * passes (bootstrap). Once calibrated, a turn's score must meet or beat the
 * p75 of the last `windowSize` scores to inject.
 */
export interface RelevanceGateOptions {
	/** Scores to keep in the rolling window. Default 20. */
	windowSize?: number;
	/** Scores required before gating kicks in. Default 4. */
	minSamples?: number;
}

export class RelevanceGate {
	private readonly _windowSize: number;
	private readonly _minSamples: number;
	private _scores: number[] = [];

	constructor(opts: RelevanceGateOptions = {}) {
		this._windowSize = opts.windowSize ?? 20;
		this._minSamples = opts.minSamples ?? 4;
	}

	private _p75(): number {
		const sorted = [...this._scores].sort((a, b) => a - b);
		const index = Math.min(sorted.length - 1, Math.floor(0.75 * sorted.length));
		return sorted[index];
	}

	/**
	 * Record this turn's score and decide whether to inject. Always records,
	 * even when the decision is "skip", so the sample reflects every turn.
	 */
	shouldInject(score: number): boolean {
		const calibrated = this._scores.length >= this._minSamples;
		const threshold = calibrated ? this._p75() : undefined;

		this._scores.push(score);
		if (this._scores.length > this._windowSize) this._scores.shift();

		if (!calibrated) return true;
		return score >= (threshold as number);
	}
}
