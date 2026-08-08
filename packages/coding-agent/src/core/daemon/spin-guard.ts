/**
 * #158 — daemon spin guard.
 *
 * The daemon logs and continues on unhandled errors so one bad session can't crash
 * every agent. But a self-perpetuating error (a broken transport retrying) would
 * then spin the event loop at 100% CPU forever, hanging every request. This tracks
 * error frequency: once too many fire within a window, the daemon is wedged and the
 * caller should shut down cleanly for a fresh restart rather than spin silently.
 */
export class SpinGuard {
	private times: number[] = [];
	private tripped = false;

	constructor(
		private readonly thresholdCount = 25,
		private readonly windowMs = 5000,
		private readonly now: () => number = Date.now,
	) {}

	/** Record an error. Returns true exactly once, when the spin threshold is first crossed. */
	record(): boolean {
		if (this.tripped) return false;
		const t = this.now();
		this.times.push(t);
		this.times = this.times.filter((x) => t - x < this.windowMs);
		if (this.times.length >= this.thresholdCount) {
			this.tripped = true;
			return true;
		}
		return false;
	}

	/** Number of errors currently within the window (for logging). */
	get count(): number {
		return this.times.length;
	}
}
