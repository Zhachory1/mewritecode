/**
 * Pure approval-policy classifier for the OPT-IN approval mode (#14).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONEST POSITIONING — READ THIS BEFORE TRUSTING THE OUTPUT
 * ─────────────────────────────────────────────────────────────────────────────
 * Approval mode forces a human to review writes/bash before they run. It is
 * **accident-prevention / human-review, NOT a security perimeter**. In
 * particular the `destructive` tier below is a best-effort string-matching
 * HEURISTIC whose ONLY job is to SURFACE obviously-dangerous commands more
 * loudly to the reviewing human. It is trivially defeated (`eval`, `$()`,
 * `base64 | sh`, `python -c`, aliases, …). Do NOT build a security decision on
 * the read/write/exec/destructive distinction — the only load-bearing line is
 * "read is free, everything else needs a human." Real containment is the
 * enforced sandbox tracked separately in #46.
 *
 * This module is pure (no I/O, no state) so it is exhaustively unit-testable and
 * cheap to call. It is threaded into the agent's `beforeToolCall` gate via a
 * closure from coding-agent — see agent-session.ts.
 */

/**
 * Risk tier of a single tool call.
 * - `read`: provably read-only (no approval needed).
 * - `write`: mutates files / unknown-but-not-provably-read-only (needs approval).
 * - `exec`: runs a shell command (needs approval).
 * - `destructive`: a shell command the heuristic flagged as obviously dangerous
 *   (needs approval; surfaced more loudly to the human — NOT a security tier).
 */
export type RiskTier = "read" | "write" | "exec" | "destructive";

/**
 * Tools we can prove are read-only / side-effect-free. Everything else is treated
 * conservatively. `clarify`/`task_status`/`memory_search` are provably read-only:
 * `clarify` only asks the user a question (and gating it would fire BEFORE the
 * user can even see the question), `task_status` reports subagent state, and
 * `memory_search` reads memory. NOTE `task`/`agent` are deliberately NOT here —
 * they spawn subagents that can write, so they must still be gated.
 */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "clarify", "task_status", "memory_search"]);

/** File-mutating tools. */
const WRITE_TOOLS = new Set(["edit", "write"]);

/** Shell-executing tools. */
const EXEC_TOOLS = new Set(["bash"]);

/**
 * Best-effort destructive-command patterns. HEURISTIC ONLY (see module header).
 * Matches are intentionally conservative on the "flag it" side and accept that
 * obfuscated equivalents slip through — those still land in `exec`, which still
 * needs approval, so the safe outcome holds either way.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
	// rm with combined recursive+force flags (rm -rf / -fr / -r -f), any order.
	/\brm\s+-[a-z]*r[a-z]*f[a-z]*\b/i,
	/\brm\s+-[a-z]*f[a-z]*r[a-z]*\b/i,
	/\brm\s+-r\b.*-f\b/i,
	/\brm\s+-f\b.*-r\b/i,
	// git force-push
	/\bgit\s+push\b.*(?:--force\b|--force-with-lease\b|\s-f\b)/i,
	// git hard reset
	/\bgit\s+reset\s+--hard\b/i,
	// destructive SQL
	/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
	/\bTRUNCATE\b/i,
];

function commandString(args: unknown): string {
	if (args && typeof args === "object" && "command" in args) {
		const cmd = (args as { command?: unknown }).command;
		if (typeof cmd === "string") return cmd;
	}
	return "";
}

/**
 * Classify a tool call into a risk tier. Pure: depends only on the tool name and
 * args. Unknown/MCP/custom tools are classified `write` (conservative-unknown:
 * anything not provably read-only requires a human).
 */
export function classifyToolCall(toolName: string, args: unknown): RiskTier {
	const name = toolName.toLowerCase();

	if (READ_ONLY_TOOLS.has(name)) return "read";
	if (WRITE_TOOLS.has(name)) return "write";

	if (EXEC_TOOLS.has(name)) {
		const cmd = commandString(args);
		// HEURISTIC surfacing only — see module header. A miss here downgrades to
		// `exec`, which still needs approval, so safety does not depend on it.
		if (cmd && DESTRUCTIVE_PATTERNS.some((re) => re.test(cmd))) {
			return "destructive";
		}
		return "exec";
	}

	// Conservative-unknown: unknown, MCP (`mcp__*`), or custom tools are not
	// provably read-only, so they require approval. `write` is the gate-on tier.
	return "write";
}

/**
 * Whether a tier requires human approval. The only free tier is `read`.
 * Pure boolean derived solely from the tier.
 */
export function needsApproval(tier: RiskTier): boolean {
	return tier !== "read";
}
