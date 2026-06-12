/**
 * Typed errors for the coding agent core.
 */

/**
 * Thrown when a prompt cannot run because there is no usable, authenticated
 * model. Carries a machine-readable {@link NoUsableAuthError.reason} so callers
 * (interactive mode, print mode) can branch on `instanceof` / `reason` instead
 * of matching the human-readable message text.
 *
 *  - `no-model`      — no model is selected at all.
 *  - `expired-oauth` — a stored OAuth credential is present but unusable
 *                      (expired / network failure).
 *  - `no-key`        — no API key (env or stored) for the model's provider.
 *
 * Subclass of `Error` so existing generic catchers (e.g. `showError`) keep
 * working unchanged.
 */
export class NoUsableAuthError extends Error {
	constructor(
		public readonly reason: "no-model" | "expired-oauth" | "no-key",
		message: string,
	) {
		super(message);
		this.name = "NoUsableAuthError";
	}
}
