/**
 * MemoryProvider — pluggable backend for Me Write Code's memory subsystem (WS7).
 *
 * Implementations:
 *   - ZbrainProvider  (default — wraps the local zbrain CLI/index)
 *   - CavememProvider (legacy — wraps cavemem stdio MCP + `cavemem hook run`)
 *   - FilesProvider   (fallback — plain `.mewrite/memory/*.md`)
 *
 * Me Write Code never reimplements embeddings, FTS, or compression: those are the
 * canonical responsibility of the configured backend.
 * Me Write Code's value-add lives one layer up:
 *   - The `consolidate()` pass clusters episodic observations and asks an LLM
 *     to extract semantic facts that are written back with provenance ids.
 *   - The MEMORY.md bridge (handled in coding-agent) imports/exports between
 *     Claude Code's per-project memory dir and cavemem.
 *
 * The interface is intentionally narrow — every method maps 1:1 onto either
 * a cavemem MCP tool, a `cavemem hook run` invocation, or a markdown read.
 *
 * Source check: no related upstream package ships this memory-provider
 *   abstraction. Existing memory packages use different designs, such as qmd-based
 *   semantic search over daily logs. We keep this interface narrow precisely
 *   so another memory adapter could land here later without churn.
 */

/** Granularity for the memory pipeline. */
export type ObservationKind = "episodic" | "semantic" | "fact" | "lesson" | string;

/** Compact hit returned by search() — bodies fetched on-demand via getObservations(). */
export interface MemoryHit {
	id: number;
	score?: number;
	kind?: ObservationKind;
	ts?: string;
	preview?: string;
	session_id?: string;
}

/** Full observation body. */
export interface MemoryObservation {
	id: number;
	session_id?: string;
	kind?: ObservationKind;
	ts?: string;
	content: string;
	metadata?: Record<string, unknown>;
	provenance?: number[];
}

/** Session metadata. */
export interface MemorySessionInfo {
	id: string;
	ide?: string;
	cwd?: string;
	started_at?: string;
	ended_at?: string | null;
}

/** Hook event names cave fires via `cavemem hook run`. */
export type MemoryHookEvent = "session-start" | "user-prompt-submit" | "post-tool-use" | "stop" | "session-end";

/** Payload passed via stdin to `cavemem hook run`. JSON-encoded. */
export interface MemoryHookPayload {
	session_id: string;
	cwd?: string;
	ide?: string;
	[key: string]: unknown;
}

/** A semantic fact written back during consolidation. */
export interface ConsolidationOutput {
	content: string;
	kind: "semantic";
	provenance: number[];
	metadata?: Record<string, unknown>;
}

export interface ConsolidationCluster {
	topic: string;
	observationIds: number[];
	previews: string[];
}

/**
 * Read/write memory backend. All operations are best-effort — callers
 * MUST tolerate `false`/empty returns gracefully (cavemem may not be
 * installed; the daemon may be offline; the user may have run `/memory off`).
 */
export interface MemoryProvider {
	/** Stable id used in slash command output and diagnostics. */
	readonly id: string;
	readonly label: string;

	/** True when the backend is wired and answering. Used by `/memory show`. */
	isAvailable(): Promise<boolean>;

	/** Fire one of the 5 lifecycle hooks. Cavemem does the writing. */
	dispatchHook(event: MemoryHookEvent, payload: MemoryHookPayload): Promise<void>;

	/** Read tools — these become surfaced as native Me Write Code tools. */
	search(query: string, opts?: { limit?: number }): Promise<MemoryHit[]>;
	timeline(sessionId: string, opts?: { around?: number; limit?: number }): Promise<MemoryHit[]>;
	getObservations(ids: number[], opts?: { expand?: boolean }): Promise<MemoryObservation[]>;
	listSessions(opts?: { limit?: number }): Promise<MemorySessionInfo[]>;

	/**
	 * Append an observation. Used by `/memory save` and the consolidation pass.
	 * Returns the new id (or `undefined` if the backend doesn't surface ids).
	 */
	save(content: string, kind?: ObservationKind, metadata?: Record<string, unknown>): Promise<number | undefined>;

	/** Soft delete (cavemem stores `kind:redacted`). */
	forget(ids: number[]): Promise<number>;

	/** Export the entire memory store to JSONL. Used by `/memory export`. */
	export(toPath: string): Promise<{ ok: boolean; bytes?: number; message?: string }>;
}

/**
 * Aggregated state surfaced by `/memory show`.
 */
export interface MemoryStatus {
	provider: string;
	available: boolean;
	enabled: boolean;
	sessionCount?: number;
	observationCount?: number;
	lastSession?: MemorySessionInfo;
	notes: string[];
}

/**
 * Combine the most-restrictive disable signal with the active provider.
 *
 * `/memory off` writes `disabled=true` to settings; we honour it across both
 * providers without forcing each backend to re-implement the logic.
 */
export interface MemoryProviderToggle {
	enabled: boolean;
	provider: MemoryProvider;
}

/** Sentinel error: cavemem CLI/MCP missing. Lets callers fall back without try/catch noise. */
export class MemoryUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MemoryUnavailableError";
	}
}

/** Empty hit list — convenience for fallbacks. */
export const NO_MEMORY_HITS: readonly MemoryHit[] = Object.freeze([]);
