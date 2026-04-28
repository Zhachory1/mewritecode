/**
 * Hooks subsystem entrypoint.
 *
 * Public API:
 *   - HooksRegistry  — load + match Claude Code-format hook configs
 *   - HooksExecutor  — run command hooks per CC contract
 *   - HooksManager   — convenience wrapper that owns both
 *   - subscribeHooksToExtensionEvents() — wire HooksManager into the
 *     existing cave extension event bus so the 12 lifecycle events
 *     fire without churning agent-session.ts. WS5/WS6 etc. can plug
 *     additional events into the manager directly.
 */

import type { CaveHookEvent, HookDispatchResult, HookStdin } from "./events.js";
import { CAVE_HOOK_EVENTS, isCaveHookEvent } from "./events.js";
import { HooksExecutor, type ExecutorOptions } from "./executor.js";
import { HooksRegistry, type HooksRegistryOptions } from "./registry.js";

export * from "./events.js";
export { HooksRegistry, type HooksRegistryOptions, type MatchedHook } from "./registry.js";
export { HooksExecutor, type ExecutorOptions } from "./executor.js";

export interface HooksManagerOptions {
	executor?: ExecutorOptions;
	registry?: HooksRegistryOptions;
	/** Returns the current session id (used for stdin payloads). */
	sessionId?: () => string;
	/** Returns cwd. Defaults to process.cwd(). */
	cwd?: () => string;
	/** Project root for $CAVE_PROJECT_DIR. Defaults to cwd. */
	projectDir?: () => string;
}

/**
 * High-level facade. One per agent session.
 */
export class HooksManager {
	readonly registry: HooksRegistry;
	readonly executor: HooksExecutor;
	private getSessionId: () => string;
	private getCwd: () => string;

	constructor(options: HooksManagerOptions = {}) {
		this.registry = new HooksRegistry(options.registry);
		this.executor = new HooksExecutor({
			...options.executor,
			cwd: options.executor?.cwd ?? options.cwd?.(),
			projectDir: options.executor?.projectDir ?? options.projectDir?.() ?? options.cwd?.(),
		});
		this.getSessionId = options.sessionId ?? (() => "cave-session");
		this.getCwd = options.cwd ?? (() => process.cwd());
	}

	/** Build a stdin payload with the manager's defaults filled in. */
	buildStdin(event: CaveHookEvent | string, extra: Partial<HookStdin> = {}): HookStdin {
		return {
			session_id: this.getSessionId(),
			cwd: this.getCwd(),
			hook_event_name: event,
			...extra,
		};
	}

	/** Run all hooks matched for an event. */
	async dispatch(
		event: CaveHookEvent | string,
		matcherInput: string | undefined,
		stdinExtras: Partial<HookStdin> = {},
	): Promise<HookDispatchResult> {
		const matched = this.registry.resolve(event, matcherInput);
		if (matched.length === 0) {
			return {
				event,
				matcher: matcherInput,
				results: [],
				continue: true,
			};
		}
		const stdin = this.buildStdin(event, stdinExtras);
		const result = await this.executor.dispatch(event, matcherInput, matched, stdin);
		// Mark `once` hooks as consumed.
		for (const m of matched) {
			this.registry.markFired(m.hook);
		}
		return result;
	}

	/**
	 * Test helper: dispatch with a synthetic stdin payload regardless of
	 * matcher input. Powers `cave hooks test <event>`.
	 */
	async test(event: CaveHookEvent | string, matcherInput: string | undefined): Promise<HookDispatchResult> {
		const stdin = this.buildStdin(event, {
			tool_name: matcherInput,
			tool_input: { command: "echo 'cave hooks test'" },
		} as Partial<HookStdin>);
		const matched = this.registry.resolve(event, matcherInput);
		const result = await this.executor.dispatch(event, matcherInput, matched, stdin);
		for (const m of matched) {
			this.registry.markFired(m.hook);
		}
		return result;
	}
}

/**
 * Minimal subset of `ExtensionAPI` we need to subscribe to.
 * Defining it locally avoids a circular import with extensions/types.ts.
 */
export interface ExtensionEventBusLike {
	on(event: string, handler: (e: any, ctx: any) => any): void;
}

/**
 * Wire a HooksManager into cave's existing extension event bus.
 *
 * This adapter translates extension events (`session_start`, `tool_call`,
 * `tool_result`, ...) to Claude Code-compatible event names + matcher
 * inputs and runs the corresponding hooks.
 *
 * Returns the manager so callers can keep tweaking the registry later.
 */
export function subscribeHooksToExtensionEvents(api: ExtensionEventBusLike, manager: HooksManager): HooksManager {
	api.on("session_start", async (e: { reason: string }) => {
		await manager.dispatch("SessionStart", reasonToSource(e.reason), { source: e.reason } as any);
	});
	api.on("session_shutdown", async () => {
		await manager.dispatch("SessionEnd", "prompt_input_exit", {
			reason: "prompt_input_exit",
		} as any);
	});
	api.on("agent_end", async () => {
		// "Stop" fires when the agent loop ends naturally. Claude Code
		// uses Stop without a matcher.
		await manager.dispatch("Stop", undefined, { stop_hook_active: true } as any);
	});
	api.on("session_compact", async () => {
		await manager.dispatch("PostCompact", "auto", { trigger: "auto" } as any);
	});
	api.on("session_before_compact", async () => {
		await manager.dispatch("PreCompact", "auto", { trigger: "auto" } as any);
	});

	// PreToolUse / PostToolUse: extension event handlers can return
	// synthetic results to block tool calls. We lean on extension API
	// semantics here — the cave runner already supports `block: true`
	// from a tool_call handler, which we map from a deny decision.
	api.on("tool_call", async (e: { toolName: string; input: Record<string, unknown>; toolCallId: string }) => {
		const out = await manager.dispatch("PreToolUse", e.toolName, {
			tool_name: e.toolName,
			tool_input: e.input,
			tool_use_id: e.toolCallId,
		} as any);
		// Apply hook patches to args in-place (extension API contract).
		if (out.updatedInput) {
			Object.assign(e.input, out.updatedInput);
		}
		if (out.permission === "deny") {
			return { block: true, reason: out.results.find((r) => r.stderr)?.stderr ?? "blocked by hook" };
		}
		return undefined;
	});
	api.on(
		"tool_result",
		async (e: {
			toolName: string;
			input: Record<string, unknown>;
			toolCallId: string;
			content: any;
			isError: boolean;
		}) => {
			await manager.dispatch("PostToolUse", e.toolName, {
				tool_name: e.toolName,
				tool_input: e.input,
				tool_response: e.content,
				tool_error: e.isError,
				tool_use_id: e.toolCallId,
			} as any);
			return undefined;
		},
	);

	api.on("input", async (e: { text: string; source: string }) => {
		const result = await manager.dispatch("UserPromptSubmit", undefined, {
			prompt: e.text,
		} as any);
		if (!result.continue) {
			return { action: "handled" };
		}
		// stdout-as-context: re-inject the text into the assistant turn.
		if (result.additionalContext) {
			return {
				action: "transform",
				text: `${e.text}\n\n<system-reminder>\n${result.additionalContext}\n</system-reminder>`,
			};
		}
		return undefined;
	});
	return manager;
}

function reasonToSource(reason: string): string {
	switch (reason) {
		case "startup":
			return "startup";
		case "resume":
		case "fork":
			return "resume";
		case "reload":
			return "clear";
		default:
			return reason;
	}
}

/** Surface the registered events for slash command listing. */
export function listSupportedEvents(): readonly string[] {
	return CAVE_HOOK_EVENTS;
}

export { isCaveHookEvent };
