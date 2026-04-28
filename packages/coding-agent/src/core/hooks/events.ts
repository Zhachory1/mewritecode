/**
 * Hook lifecycle events — Claude Code v2.1.119-compatible schema.
 *
 * Source of truth: https://code.claude.com/docs/en/hooks
 * (See settings.json `hooks` key.)
 *
 * The full Claude Code event list is large; cave WS4 ships the 12 events
 * called out in the v2 master plan:
 *   SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStop,
 *   PreToolUse, PostToolUse, PreCompact, PostCompact, Notification,
 *   FileChanged, CwdChanged
 *
 * Other Claude Code events (UserPromptExpansion, PermissionRequest, etc.)
 * are accepted by the parser as opaque event names so that a user pasting
 * a fuller `~/.claude/settings.json` `hooks` block does not get a parse
 * error — the events simply will not be fired by cave (yet).
 */

/** The 12 cave-supported lifecycle events. */
export const CAVE_HOOK_EVENTS = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"Stop",
	"SubagentStop",
	"PreToolUse",
	"PostToolUse",
	"PreCompact",
	"PostCompact",
	"Notification",
	"FileChanged",
	"CwdChanged",
] as const;

export type CaveHookEvent = (typeof CAVE_HOOK_EVENTS)[number];

export function isCaveHookEvent(name: string): name is CaveHookEvent {
	return (CAVE_HOOK_EVENTS as readonly string[]).includes(name);
}

/**
 * Hook hook-type. v1 ships "command" only.
 * "http" / "prompt" / "agent" / "mcp_tool" are recognized for forward compat
 * but not executed (deferred to v2).
 */
export type HookType = "command" | "http" | "prompt" | "agent" | "mcp_tool";

/** Schema for one hook (Claude Code-compatible). */
export interface HookConfig {
	/** Hook execution type. Default: "command". */
	type?: HookType;
	/** Optional gating predicate (e.g. `Bash(git *)`). Currently informational; matcher is the primary gate. */
	if?: string;
	/** Per-hook timeout in seconds. Cave default: 600 (10 min). PreToolUse plan-default: 30. */
	timeout?: number;
	/** Custom spinner message shown while the hook runs. */
	statusMessage?: string;
	/** Run only once per session. */
	once?: boolean;

	// command hook
	/** Shell command to execute. Required when type === "command". */
	command?: string;
	/** Run in the background (PostToolUse default). PreToolUse forces sync. */
	async?: boolean;
	/** Wake the agent when an async hook completes. Forward-compat field. */
	asyncRewake?: boolean;
	/** Shell to use ("bash" | "powershell"). Defaults to platform shell. */
	shell?: "bash" | "powershell";

	// http hook (deferred)
	url?: string;
	headers?: Record<string, string>;
	allowedEnvVars?: string[];

	// mcp_tool / prompt / agent (deferred)
	server?: string;
	tool?: string;
	input?: Record<string, unknown>;
	prompt?: string;
	model?: string;
}

/** A matcher group binding one or more hooks to a matcher pattern. */
export interface HookMatcherGroup {
	/**
	 * Matcher pattern.
	 *  - For tool events: a regex against the tool name (`Bash`, `Edit|Write`, `mcp__memory__.*`).
	 *  - For SessionStart: `startup` | `resume` | `clear` | `compact`.
	 *  - For SessionEnd: `clear` | `resume` | `logout` | `prompt_input_exit`.
	 *  - For PreCompact/PostCompact: `manual` | `auto`.
	 *  - For SubagentStop: agent type or `*`.
	 *  - For Stop, UserPromptSubmit, FileChanged, CwdChanged, Notification:
	 *    optional, treated as a regex against the matcher string for that event.
	 *  - `*` or empty/undefined matches everything.
	 */
	matcher?: string;
	hooks: HookConfig[];
}

/** Top-level `hooks` map: event name -> matcher groups. */
export type HooksConfig = Partial<Record<CaveHookEvent, HookMatcherGroup[]>> & Record<string, HookMatcherGroup[]>;

/**
 * Permission decisions a PreToolUse hook can return.
 * Per Claude Code: stdout JSON `hookSpecificOutput.permissionDecision`.
 */
export type PermissionDecision = "allow" | "deny" | "ask" | "defer";

/**
 * JSON the hook may print to stdout on exit 0.
 * Cave is lenient: unknown keys are ignored.
 */
export interface HookJsonOutput {
	/** If false, instructs the agent to halt. */
	continue?: boolean;
	/** Reason shown when continue: false. */
	stopReason?: string;
	/** Suppress stdout-as-context injection for non-zero-exit messaging. */
	suppressOutput?: boolean;
	/** Extra system-level message to surface to the user. */
	systemMessage?: string;

	/** Top-level "block" is shorthand for PreToolUse deny. */
	decision?: "block" | "approve" | "ask" | undefined;
	reason?: string;

	hookSpecificOutput?: {
		hookEventName?: CaveHookEvent | string;
		permissionDecision?: PermissionDecision;
		permissionDecisionReason?: string;
		updatedInput?: Record<string, unknown>;
		additionalContext?: string;
		updatedToolOutput?: unknown;
		[key: string]: unknown;
	};
}

/** Stdin payload sent to every command hook. */
export interface HookStdinBase {
	session_id: string;
	transcript_path?: string;
	cwd: string;
	hook_event_name: CaveHookEvent | string;
	permission_mode?: string;
	agent_id?: string;
	agent_type?: string;
}

export interface PreToolUseStdin extends HookStdinBase {
	tool_name: string;
	tool_input: Record<string, unknown>;
	tool_use_id?: string;
}

export interface PostToolUseStdin extends PreToolUseStdin {
	tool_response?: unknown;
	tool_error?: boolean;
}

export interface UserPromptSubmitStdin extends HookStdinBase {
	prompt: string;
}

export interface SessionStartStdin extends HookStdinBase {
	source: "startup" | "resume" | "clear" | "compact" | string;
}

export interface SessionEndStdin extends HookStdinBase {
	reason: "clear" | "resume" | "logout" | "prompt_input_exit" | string;
}

export interface FileChangedStdin extends HookStdinBase {
	file_path: string;
	change_type?: "created" | "modified" | "deleted";
}

export interface CwdChangedStdin extends HookStdinBase {
	old_cwd: string;
	new_cwd: string;
}

export interface CompactStdin extends HookStdinBase {
	trigger: "manual" | "auto" | string;
}

export interface NotificationStdin extends HookStdinBase {
	notification_type: string;
	message?: string;
}

export interface StopStdin extends HookStdinBase {
	stop_hook_active?: boolean;
}

export type HookStdin =
	| PreToolUseStdin
	| PostToolUseStdin
	| UserPromptSubmitStdin
	| SessionStartStdin
	| SessionEndStdin
	| FileChangedStdin
	| CwdChangedStdin
	| CompactStdin
	| NotificationStdin
	| StopStdin
	| HookStdinBase;

/** Result of running a single hook. */
export interface HookExecutionResult {
	hookConfig: HookConfig;
	matcher: string | undefined;
	exitCode: number;
	/** True if hook timed out and was killed. */
	timedOut: boolean;
	stdout: string;
	stderr: string;
	parsedOutput?: HookJsonOutput;
	durationMs: number;
	/** Set when execution failed before the process exited (spawn error etc.). */
	error?: string;
	/** Permission decision derived from JSON output and exit code (PreToolUse only). */
	permission?: PermissionDecision;
	/** Stdout-as-context payload accumulated for the next assistant turn. */
	additionalContext?: string;
	/** Whether the hook ran asynchronously (PostToolUse). */
	async?: boolean;
}

/** Aggregate decision after running every matched hook for a single event. */
export interface HookDispatchResult {
	event: CaveHookEvent | string;
	matcher: string | undefined;
	results: HookExecutionResult[];
	/**
	 * Most-restrictive permission across all PreToolUse hooks.
	 * deny > ask > defer > allow > undefined.
	 */
	permission?: PermissionDecision;
	/** Aggregated stdout-as-context. Joined with double newlines. */
	additionalContext?: string;
	/** Aggregated `updatedInput` patches (last writer wins). */
	updatedInput?: Record<string, unknown>;
	/** Set when any hook returned `continue: false`. */
	continue: boolean;
	/** Reason for stopping (first non-empty stopReason wins). */
	stopReason?: string;
}

/** Resolves the most-restrictive PreToolUse decision. */
export function combineDecisions(decisions: (PermissionDecision | undefined)[]): PermissionDecision | undefined {
	const order: PermissionDecision[] = ["deny", "ask", "defer", "allow"];
	for (const candidate of order) {
		if (decisions.includes(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Default per-event timeouts in seconds.
 * - PreToolUse: 30s (per cave v2 master plan §6 WS4).
 * - All other events: 600s (10 min, Claude Code default).
 */
export const DEFAULT_TIMEOUTS_S: Record<string, number> = {
	PreToolUse: 30,
	default: 600,
};

export function defaultTimeoutForEvent(event: string): number {
	return DEFAULT_TIMEOUTS_S[event] ?? DEFAULT_TIMEOUTS_S.default;
}

/** Whether this event is synchronous + blocking by default. */
export function isBlockingEvent(event: string): boolean {
	return event === "PreToolUse";
}
