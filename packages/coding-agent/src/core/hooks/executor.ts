/**
 * Hooks executor. Runs a single hook (or a batch) per Claude Code's
 * shell-command contract:
 *
 *   stdin  : JSON payload with session_id, cwd, hook_event_name, ...
 *   stdout : optional JSON envelope (continue/decision/...) — exit 0 only
 *   stderr : surfaced to user / agent transcript
 *   exit 0 : success. JSON parsed. stdout-as-context for SessionStart /
 *            UserPromptSubmit / Stop.
 *   exit 2 : blocking error. stderr piped to agent as a system reminder.
 *            For PreToolUse this is equivalent to permission "deny".
 *   else   : non-blocking advisory error.
 *
 * stdout-as-context (the WS4 differentiator): for SessionStart,
 * UserPromptSubmit, and Stop, the hook's stdout is collected and
 * re-injected into the next assistant turn as a system reminder so
 * the model can react to it. PreToolUse + PostToolUse can do the
 * same via `hookSpecificOutput.additionalContext`.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { combineDecisions, defaultTimeoutForEvent, isBlockingEvent } from "./events.js";
import type {
	CaveHookEvent,
	HookConfig,
	HookDispatchResult,
	HookExecutionResult,
	HookJsonOutput,
	HookStdin,
	PermissionDecision,
} from "./events.js";
import type { MatchedHook } from "./registry.js";

export interface ExecutorOptions {
	/** Working directory for hook subprocesses. Defaults to cwd from stdin payload. */
	cwd?: string;
	/** Project root used for `$CLAUDE_PROJECT_DIR` / `$CAVE_PROJECT_DIR`. */
	projectDir?: string;
	/** Override env. Merged on top of process.env. */
	env?: Record<string, string | undefined>;
	/** Force-disable async behavior (PostToolUse). Useful for tests. */
	forceSync?: boolean;
	/** Logger callback for observability. */
	onResult?: (result: HookExecutionResult) => void;
	/** Custom child_process.spawn (for tests). */
	spawn?: typeof spawn;
}

const HOOK_PROCESS_LIMIT_BYTES = 4 * 1024 * 1024;

export class HooksExecutor {
	private options: ExecutorOptions;
	private spawnFn: typeof spawn;

	constructor(options: ExecutorOptions = {}) {
		this.options = options;
		this.spawnFn = options.spawn ?? spawn;
	}

	/**
	 * Run one hook to completion.
	 *
	 * Always resolves; any spawn failure is converted into a non-zero exit
	 * code so callers don't have to try/catch.
	 */
	async runOne(
		event: CaveHookEvent | string,
		matcher: string | undefined,
		hook: HookConfig,
		stdin: HookStdin,
	): Promise<HookExecutionResult> {
		const startedAt = Date.now();
		const type = hook.type ?? "command";

		// v1 only ships `command`. Other types parse cleanly but no-op so
		// existing Claude Code settings don't break.
		if (type !== "command") {
			const result: HookExecutionResult = {
				hookConfig: hook,
				matcher,
				exitCode: 0,
				timedOut: false,
				stdout: "",
				stderr: `[cave] hook type='${type}' is not yet implemented; skipped`,
				durationMs: 0,
				error: undefined,
				async: false,
			};
			this.options.onResult?.(result);
			return result;
		}

		if (typeof hook.command !== "string" || hook.command.trim().length === 0) {
			const result: HookExecutionResult = {
				hookConfig: hook,
				matcher,
				exitCode: 1,
				timedOut: false,
				stdout: "",
				stderr: "hook command is empty",
				durationMs: 0,
				error: "empty command",
			};
			this.options.onResult?.(result);
			return result;
		}

		const timeoutSec = hook.timeout ?? defaultTimeoutForEvent(event);
		const timeoutMs = Math.max(1, Math.floor(timeoutSec * 1000));
		const cwd = this.options.cwd ?? stdin.cwd;
		const projectDir = this.options.projectDir ?? cwd;

		const { shell, shellArg } = pickShell(hook.shell);
		const env = {
			...process.env,
			...this.options.env,
			CAVE_PROJECT_DIR: projectDir,
			CLAUDE_PROJECT_DIR: projectDir, // Claude Code-compatible alias
			CAVE_SESSION_ID: stdin.session_id,
			CAVE_HOOK_EVENT: event,
		};

		const result: HookExecutionResult = await new Promise((resolve) => {
			let child: ReturnType<typeof spawn>;
			try {
				child = this.spawnFn(shell, [shellArg, hook.command as string], {
					cwd,
					env,
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (err) {
				resolve({
					hookConfig: hook,
					matcher,
					exitCode: 1,
					timedOut: false,
					stdout: "",
					stderr: err instanceof Error ? err.message : String(err),
					durationMs: Date.now() - startedAt,
					error: err instanceof Error ? err.message : String(err),
				});
				return;
			}

			let stdoutBuf = "";
			let stderrBuf = "";
			let stdoutBytes = 0;
			let stderrBytes = 0;
			let timedOut = false;

			const timer = setTimeout(() => {
				timedOut = true;
				try {
					child.kill("SIGTERM");
					setTimeout(() => {
						try {
							child.kill("SIGKILL");
						} catch {
							/* already gone */
						}
					}, 1000).unref?.();
				} catch {
					/* ignore */
				}
			}, timeoutMs);
			timer.unref?.();

			child.stdout?.on("data", (chunk: Buffer) => {
				stdoutBytes += chunk.length;
				if (stdoutBytes <= HOOK_PROCESS_LIMIT_BYTES) {
					stdoutBuf += chunk.toString("utf8");
				}
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderrBytes += chunk.length;
				if (stderrBytes <= HOOK_PROCESS_LIMIT_BYTES) {
					stderrBuf += chunk.toString("utf8");
				}
			});
			child.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					hookConfig: hook,
					matcher,
					exitCode: 1,
					timedOut,
					stdout: stdoutBuf,
					stderr: `${stderrBuf}\n${err.message}`,
					durationMs: Date.now() - startedAt,
					error: err.message,
				});
			});
			child.on("close", (code, signal) => {
				clearTimeout(timer);
				const exitCode = typeof code === "number" ? code : signal ? 137 : 1;
				resolve({
					hookConfig: hook,
					matcher,
					exitCode,
					timedOut,
					stdout: stdoutBuf,
					stderr: stderrBuf,
					durationMs: Date.now() - startedAt,
					error: timedOut ? `timed out after ${timeoutSec}s` : undefined,
				});
			});

			try {
				child.stdin?.write(JSON.stringify(stdin));
				child.stdin?.end();
			} catch {
				// stdin may already be closed if the child errored fast — not fatal.
			}
		});

		// Parse JSON envelope on exit 0.
		if (result.exitCode === 0 && result.stdout.trim().startsWith("{")) {
			result.parsedOutput = parseJsonOutput(result.stdout);
		}

		// Derive PreToolUse permission and stdout-as-context.
		decorateResult(event, result);

		this.options.onResult?.(result);
		return result;
	}

	/**
	 * Dispatch every matched hook for a single event. PreToolUse blocks
	 * the agent loop synchronously; PostToolUse is async by default and
	 * may be fire-and-forget.
	 */
	async dispatch(
		event: CaveHookEvent | string,
		matcherInput: string | undefined,
		matched: MatchedHook[],
		stdin: HookStdin,
	): Promise<HookDispatchResult> {
		if (matched.length === 0) {
			return {
				event,
				matcher: matcherInput,
				results: [],
				continue: true,
			};
		}

		const blocking = isBlockingEvent(event);
		const results: HookExecutionResult[] = [];

		// Run hooks sequentially within a single dispatch — preserves
		// "deny short-circuits" semantics matching Claude Code.
		for (const match of matched) {
			const isAsync = !this.options.forceSync && !blocking && (match.hook.async ?? defaultAsyncFor(event));

			if (isAsync) {
				// Fire and forget; surface result through onResult only.
				void this.runOne(event, match.matcher, match.hook, stdin).then((r) => {
					r.async = true;
				});
				continue;
			}

			const result = await this.runOne(event, match.matcher, match.hook, stdin);
			results.push(result);

			// Short-circuit on deny / continue:false for blocking events.
			if (blocking && result.permission === "deny") {
				break;
			}
			if (result.parsedOutput?.continue === false) {
				break;
			}
		}

		// Aggregate.
		const decisions = results.map((r) => r.permission);
		const permission = combineDecisions(decisions);
		const additional = results
			.map((r) => r.additionalContext)
			.filter((s): s is string => typeof s === "string" && s.length > 0)
			.join("\n\n");
		const updatedInput = mergeUpdatedInput(results);
		const continueAll = !results.some((r) => r.parsedOutput?.continue === false);
		const stopReason = results.find((r) => r.parsedOutput?.continue === false)?.parsedOutput?.stopReason ?? undefined;

		return {
			event,
			matcher: matcherInput,
			results,
			permission,
			additionalContext: additional || undefined,
			updatedInput,
			continue: continueAll,
			stopReason,
		};
	}
}

function defaultAsyncFor(event: string): boolean {
	// PostToolUse defaults to async/advisory.
	return event === "PostToolUse";
}

function pickShell(requested: HookConfig["shell"]): { shell: string; shellArg: string } {
	if (requested === "powershell") {
		return { shell: "powershell.exe", shellArg: "-Command" };
	}
	if (process.platform === "win32" && requested !== "bash") {
		return { shell: "cmd.exe", shellArg: "/c" };
	}
	return { shell: process.env.SHELL || "/bin/sh", shellArg: "-c" };
}

function parseJsonOutput(stdout: string): HookJsonOutput | undefined {
	try {
		const parsed = JSON.parse(stdout) as HookJsonOutput;
		if (!parsed || typeof parsed !== "object") return undefined;
		return parsed;
	} catch {
		// Treat unparseable JSON as plain stdout-as-context.
		return undefined;
	}
}

/** Decorate a HookExecutionResult with permission + additionalContext. */
function decorateResult(event: string, result: HookExecutionResult): void {
	const json = result.parsedOutput;

	// PreToolUse permission resolution.
	if (event === "PreToolUse") {
		if (result.exitCode === 2) {
			result.permission = "deny";
		} else if (json?.hookSpecificOutput?.permissionDecision) {
			const v = json.hookSpecificOutput.permissionDecision;
			if (v === "allow" || v === "deny" || v === "ask" || v === "defer") {
				result.permission = v as PermissionDecision;
			}
		} else if (json?.decision === "block") {
			result.permission = "deny";
		} else if (json?.decision === "approve") {
			result.permission = "allow";
		} else if (json?.decision === "ask") {
			result.permission = "ask";
		} else if (result.exitCode !== 0) {
			result.permission = "deny";
		}
	}

	// Additional context for the next assistant turn.
	const explicit = json?.hookSpecificOutput?.additionalContext;
	if (typeof explicit === "string" && explicit.length > 0) {
		result.additionalContext = explicit;
	} else if (result.exitCode === 0 && isContextEmittingEvent(event) && !json && result.stdout.trim().length > 0) {
		// stdout-as-context: text-only stdout on success becomes a system
		// reminder for the next assistant turn (the WS4 differentiator).
		result.additionalContext = result.stdout.trim();
	} else if (result.exitCode === 2 && result.stderr.trim().length > 0) {
		// Per CC: exit 2 stderr is fed back to the assistant as an error.
		result.additionalContext = result.stderr.trim();
	}
}

function isContextEmittingEvent(event: string): boolean {
	return (
		event === "SessionStart" ||
		event === "UserPromptSubmit" ||
		event === "Stop" ||
		event === "PreCompact" ||
		event === "PostCompact"
	);
}

function mergeUpdatedInput(results: HookExecutionResult[]): Record<string, unknown> | undefined {
	let merged: Record<string, unknown> | undefined;
	for (const r of results) {
		const patch = r.parsedOutput?.hookSpecificOutput?.updatedInput;
		if (patch && typeof patch === "object") {
			merged = { ...(merged ?? {}), ...patch };
		}
	}
	return merged;
}

/** Resolve a recipe path relative to cave's bundled `recipes/` directory. */
export function resolveRecipePath(recipesDir: string, recipe: string): string {
	return join(recipesDir, recipe);
}
