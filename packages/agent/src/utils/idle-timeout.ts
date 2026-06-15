/**
 * Thrown by {@link withIdleTimeout} when a wrapped async iterable produces no
 * value within the configured idle window. Used to detect a stalled model
 * stream (provider opened the connection then stopped sending bytes) so the
 * agent loop can abort and surface a retryable error instead of hanging forever.
 */
export class StreamIdleTimeoutError extends Error {
	constructor(public readonly idleMs: number) {
		super(`Stream idle for ${idleMs}ms with no activity`);
		this.name = "StreamIdleTimeoutError";
	}
}

/**
 * Thrown by {@link withTotalTimeout} when a wrapped async iterable has not
 * completed within a total wall-clock budget. Unlike {@link StreamIdleTimeoutError}
 * (which fires only on inactivity), this fires on a single deadline that does NOT
 * reset per value — it caps a turn that streams steadily but slowly so it can
 * never run arbitrarily long. The agent loop aborts the underlying request and
 * surfaces a retryable error, just like the idle case.
 */
export class StreamTotalTimeoutError extends Error {
	constructor(public readonly totalMs: number) {
		super(`Stream exceeded total timeout of ${totalMs}ms`);
		this.name = "StreamTotalTimeoutError";
	}
}

/**
 * Wrap an async iterable with an inactivity watchdog.
 *
 * Yields every value from `source` unchanged, but if no value arrives within
 * `idleMs` milliseconds the iteration throws {@link StreamIdleTimeoutError}.
 * The timer resets on every yielded value, so a steadily-streaming source never
 * trips. `idleMs <= 0` disables the watchdog (plain passthrough).
 *
 * `onTimeout` (if provided) fires exactly once, just before the throw — use it
 * to tear down the underlying source (e.g. abort the HTTP request) so the
 * orphaned `next()` promise and its socket are released.
 */
export async function* withIdleTimeout<T>(
	source: AsyncIterable<T>,
	idleMs: number,
	onTimeout?: () => void,
): AsyncGenerator<T> {
	if (!idleMs || idleMs <= 0) {
		yield* source;
		return;
	}

	const iterator = source[Symbol.asyncIterator]();
	while (true) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const idle = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new StreamIdleTimeoutError(idleMs)), idleMs);
		});

		let result: IteratorResult<T>;
		try {
			result = await Promise.race([iterator.next(), idle]);
		} catch (err) {
			if (err instanceof StreamIdleTimeoutError) {
				onTimeout?.();
			}
			throw err;
		} finally {
			if (timer) clearTimeout(timer);
		}

		if (result.done) return;
		yield result.value;
	}
	// NOTE: deliberately no `iterator.return()` cleanup — the underlying
	// EventStream generator is parked on a never-resolving promise during a
	// stall, and awaiting its return would deadlock. Teardown of the real
	// resource (the HTTP request) happens via the `onTimeout` abort instead.
}

/**
 * Wrap an async iterable with a single total wall-clock deadline.
 *
 * Yields every value from `source` unchanged, but if the iteration has not
 * completed within `totalMs` milliseconds the iteration throws
 * {@link StreamTotalTimeoutError}. Unlike {@link withIdleTimeout}, the deadline
 * is set ONCE at the start and never resets — a source that streams steadily but
 * slowly will still trip once the budget is exhausted. `totalMs <= 0` disables
 * the deadline (plain passthrough), which is the non-breaking default.
 *
 * `onTimeout` (if provided) fires exactly once, just before the throw — use it
 * to tear down the underlying source (e.g. abort the HTTP request) so the
 * orphaned `next()` promise and its socket are released.
 *
 * Mirrors {@link withIdleTimeout}'s teardown contract: no `iterator.return()`
 * on timeout (would deadlock against a parked EventStream generator); the real
 * resource is released via `onTimeout`.
 */
export async function* withTotalTimeout<T>(
	source: AsyncIterable<T>,
	totalMs: number,
	onTimeout?: () => void,
): AsyncGenerator<T> {
	if (!totalMs || totalMs <= 0) {
		yield* source;
		return;
	}

	const iterator = source[Symbol.asyncIterator]();
	let fired = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Single deadline shared across all iterations — does NOT reset per value.
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new StreamTotalTimeoutError(totalMs)), totalMs);
	});

	try {
		while (true) {
			let result: IteratorResult<T>;
			try {
				result = await Promise.race([iterator.next(), deadline]);
			} catch (err) {
				if (err instanceof StreamTotalTimeoutError && !fired) {
					fired = true;
					onTimeout?.();
				}
				throw err;
			}

			if (result.done) return;
			yield result.value;
		}
	} finally {
		if (timer) clearTimeout(timer);
	}
}
