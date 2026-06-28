/**
 * `Task` built-in tool — fan-out subagent orchestration with parallel + chain
 * modes and worktree isolation.
 *
 * Modes (exactly one must be set per call):
 *   - single   { agent, task }                  → run one agent
 *   - parallel { tasks: [{agent, task}] }       → fan out, concurrency-limited
 *   - chain    { chain: [{agent, task}] }       → sequential, output → next
 *
 * Hard caps:
 *   - MAX_PARALLEL_SUBAGENTS = 7  (plan §6 — matches Claude Code)
 *   - MAX_CONCURRENCY = 4         (CPU safety)
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import {
	autoCleanupWorktree,
	type CreateWorktreeResult,
	createWorktree,
	detectRepoRoot,
	MAX_PARALLEL_SUBAGENTS,
	type SubagentDef,
	type SubagentDefWithOutputSchema,
	type SubagentResult,
	sanitizeId,
	validateSubagentOutput,
} from "@zhachory1/mewrite-agent";
import { Text } from "@zhachory1/mewrite-tui";
import { APP_NAME, CONFIG_DIR_NAME } from "../../config.js";
import {
	filterAgentsByMcpAvailability,
	findAgentDef,
	formatAgentList,
	type LoadAgentDefsResult,
	loadAgentDefs,
} from "../agent-defs/loader.js";
import {
	type BackgroundSubagent,
	getTaskOutputPath,
	registerBackground,
	updateBackground,
} from "../background-task-registry.js";
import type { ToolDefinition } from "../extensions/types.js";

const MAX_CONCURRENCY = 4;

/**
 * Grace period between SIGTERM and the forced SIGKILL escalation when killing a
 * spawned subagent child on abort. Gives a well-behaved child time to exit
 * cleanly before we hard-kill it.
 */
const SIGKILL_GRACE_MS = 5_000;

/**
 * Hard cap on subagent recursion depth. Tracked via the `CAVE_SUBAGENT_DEPTH`
 * env var, incremented by each spawn. Without a cap a subagent that itself has
 * the `task` tool active can fan out indefinitely.
 */
const MAX_SUBAGENT_DEPTH = 3;
const SUBAGENT_DEPTH_ENV = "CAVE_SUBAGENT_DEPTH";
const MAX_PARENT_RESULT_CHARS = 20_000;
const MAX_PARALLEL_PARENT_RESULT_CHARS = 60_000;
const MIN_PARALLEL_RESULT_CHARS = 4_000;
let persistedResultCounter = 0;

function currentSubagentDepth(): number {
	const raw = process.env[SUBAGENT_DEPTH_ENV];
	const n = raw ? Number.parseInt(raw, 10) : 0;
	return Number.isFinite(n) && n > 0 ? n : 0;
}

function persistFullResult(text: string): string {
	persistedResultCounter += 1;
	const outputPath = getTaskOutputPath(`foreground-${Date.now().toString(36)}-${persistedResultCounter}`);
	writeFileSync(outputPath, text, { encoding: "utf8", mode: 0o600 });
	return outputPath;
}

function truncateParentResult(text: string, maxChars = MAX_PARENT_RESULT_CHARS): string {
	if (text.length <= maxChars) return text;
	const headChars = Math.ceil(maxChars * 0.6);
	const tailChars = maxChars - headChars;
	const omitted = text.length - headChars - tailChars;
	const outputPath = persistFullResult(text);
	return [
		text.slice(0, headChars),
		`\n\n[... ${omitted} chars omitted from subagent result; full result saved at ${outputPath} ...]\n\n`,
		text.slice(text.length - tailChars),
	].join("");
}

function subagentResultBody(result: SubagentResult): string {
	if (result.exitCode === 0) return result.output || "(no output)";
	const parts: string[] = [];
	if (result.error) parts.push(`Error: ${result.error}`);
	if (result.output) parts.push(`Output:\n${result.output}`);
	return parts.join("\n\n") || "(no output)";
}

function formatSubagentResultForParent(result: SubagentResult, maxChars = MAX_PARENT_RESULT_CHARS): string {
	const status = result.exitCode === 0 ? "OK" : "FAIL";
	return [`## ${result.agent} — ${status}`, "", truncateParentResult(subagentResultBody(result), maxChars)].join("\n");
}

// ─── Schema ───────────────────────────────────────────────────────────────

const TaskItemSchema = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke (must exist in .cave/agents/)" }),
	task: Type.String({ description: "Task description handed to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Override working directory for this invocation" })),
	model: Type.Optional(
		Type.String({
			description: "Override the agent's frontmatter model (e.g. anthropic/claude-haiku-4-5)",
		}),
	),
	mode: Type.Optional(
		Type.Union([Type.Literal("plan"), Type.Literal("auto")], {
			description: "Override chat mode for this subagent run (plan = read-only, auto = full)",
		}),
	),
});

const ChainItemSchema = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task; use {previous} to splice prior agent's output" }),
	cwd: Type.Optional(Type.String({ description: "Override working directory" })),
	model: Type.Optional(Type.String({ description: "Override the agent's frontmatter model for this step" })),
	mode: Type.Optional(Type.Union([Type.Literal("plan"), Type.Literal("auto")])),
});

const TaskSchema = Type.Object({
	agent: Type.Optional(Type.String({ description: "Single-mode: agent name" })),
	task: Type.Optional(Type.String({ description: "Single-mode: task description" })),
	cwd: Type.Optional(Type.String({ description: "Single-mode: override working directory" })),
	model: Type.Optional(Type.String({ description: "Single-mode: override the agent's frontmatter model" })),
	mode: Type.Optional(Type.Union([Type.Literal("plan"), Type.Literal("auto")])),
	tasks: Type.Optional(Type.Array(TaskItemSchema, { description: "Parallel mode: array of {agent,task}" })),
	chain: Type.Optional(
		Type.Array(ChainItemSchema, { description: "Chain mode: sequential {agent,task}, {previous} substituted" }),
	),
});

export type TaskToolInput = Static<typeof TaskSchema>;

// ─── Details (returned for renderer / observability) ──────────────────────

export interface TaskToolDetails {
	mode: "single" | "parallel" | "chain" | "async_launched";
	results: SubagentResult[];
	asyncLaunches?: AsyncLaunch[];
}

export interface AsyncLaunch {
	agentId: string;
	subagentName: string;
	outputFile: string;
	name?: string;
}

// ─── Spawning a child cave process for a subagent ─────────────────────────

/**
 * Per-event progress callback for streaming subagent updates back to the
 * parent. Fires on every JSON event the spawned cave child emits (turn_start,
 * tool_execution_start, message_end, etc.), so consumers can render live
 * activity in the TUI without waiting for the child to exit.
 */
export interface SubagentProgressEvent {
	subagentName: string;
	subagentId: string;
	phase: "started" | "tool" | "message" | "completed" | "failed";
	detail?: string;
}

export type SubagentProgressCallback = (event: SubagentProgressEvent) => void;

interface SpawnOptions {
	cwd: string;
	agent: SubagentDef;
	task: string;
	signal?: AbortSignal;
	caveBin?: string;
	/** Inject a fake spawner for tests. */
	mockSpawn?: typeof spawn;
	/** Subagent invocation id (parent → TUI correlation). Defaults to agent name. */
	subagentId?: string;
	/** Per-JSON-event progress sink. */
	onProgress?: SubagentProgressCallback;
	/**
	 * Resolve the model to actually spawn the subagent with. If the agent's
	 * frontmatter model isn't reachable (e.g. the user has no Anthropic key
	 * but the agent says `model: claude-haiku-4-5`), this callback returns
	 * the parent's current model so the child inherits a working provider.
	 * Returning `undefined` drops the `--model` flag entirely (child uses
	 * settings default).
	 */
	resolveModel?: (agentModel: string | undefined) => string | undefined;
	/**
	 * Map of `ENV_VAR_NAME → value` to merge into the child's environment.
	 * Used to forward parent-only runtime API keys (set via `--api-key` and
	 * never written to disk) so the spawned subagent can authenticate against
	 * the same provider as the parent.
	 */
	envOverrides?: Record<string, string>;
}

interface SpawnResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	finalText: string;
}

/**
 * Resolve which executable to spawn. Mirrors the upstream subagent
 * invocation pattern — prefer the current process binary (so tests with tsx
 * run with tsx; production runs with node + dist), falling back to
 * `cave` on PATH.
 */
function resolveCaveInvocation(args: string[], caveBin?: string): { command: string; args: string[] } {
	if (caveBin) return { command: caveBin, args };
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: APP_NAME, args };
}

/**
 * Spawn a single cave child process for `agent` with `task` as the prompt.
 * Returns aggregated stdout/stderr + the final assistant text from the
 * JSON-stream output.
 *
 * P0: relies on JSON-mode events. P1 (deferred): structured tool-call telemetry
 * with live updates back to the parent renderer.
 */
// Thinking levels that map directly from agent.md `effort:`. Anything else is dropped.
const VALID_EFFORT_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

/**
 * Default tool allow-list a child cave starts with when no `--tools` flag is
 * passed: the writeable coding set (read/bash/edit/write). Mirrors
 * `coding-agent`'s `codingTools` and the `--tools` help default. Kept as a
 * literal here to avoid importing the heavy tools barrel (and a cycle) into the
 * task tool; the drift-guard test for VALID_TOOL_NAMES catches divergence.
 */
const DEFAULT_CHILD_TOOLS = ["read", "bash", "edit", "write"] as const;

/**
 * Compute the `--tools` allow-list to pass to a spawned child for `agent`.
 *
 * The child cave's `--tools` flag is allow-list ONLY (no `--disallowed-tools`),
 * so a deny-list must be resolved into an allow-list here:
 *   - `tools:` set      → allow-list = tools minus disallowedTools
 *   - only `disallowed` → allow-list = DEFAULT_CHILD_TOOLS minus disallowedTools
 *   - neither           → undefined (child uses its own full default)
 *
 * Returns the comma-joined allow-list, or `undefined` when no `--tools` flag
 * should be emitted (unscoped agent → full child default).
 *
 * #41: previously the deny-list was only applied inside the `tools:`-present
 * branch, so an agent with `disallowedTools` but no `tools:` silently got full
 * access. This resolves the deny-list in BOTH cases.
 */
function computeChildToolsArg(agent: SubagentDef): string | undefined {
	const blocked = new Set(agent.disallowedTools ?? []);
	if (agent.tools && agent.tools.length > 0) {
		const filtered = agent.tools.filter((t) => !blocked.has(t));
		return filtered.length > 0 ? filtered.join(",") : undefined;
	}
	if (blocked.size > 0) {
		const filtered = DEFAULT_CHILD_TOOLS.filter((t) => !blocked.has(t));
		// If every default tool is denied we still emit nothing meaningful; fall
		// back to undefined so the child keeps its own default rather than getting
		// an empty `--tools` (which `args.ts` would treat as "no valid tools").
		return filtered.length > 0 ? filtered.join(",") : undefined;
	}
	return undefined;
}

/**
 * Build the child environment for a spawned subagent.
 *
 * #41 (delegated-approval-at-spawn): the `task` tool call is itself classified
 * exec/needs-approval (`task`/`agent` are NOT in approval-policy's
 * READ_ONLY_TOOLS), so the PARENT's `beforeToolCall` approval gate already
 * fired and the user approved spawning this subagent BEFORE `task.execute()`
 * ran. Reaching the spawn therefore means the delegation is authorized — one
 * approval covers the whole delegation. We strip `CAVE_APPROVAL_MODE` from the
 * child so it runs autopilot and can actually write, instead of inheriting an
 * approval gate it has no interactive TTY to satisfy (which silently denied
 * every write/edit/bash → the child did nothing while the parent saw exit 0).
 *
 * This is secure: the spawn was GATED, not bypassed. In headless `--approval`
 * parents the parent's task call is denied-by-default → no spawn → the strip is
 * moot, so doing it unconditionally is safe.
 */
function buildChildEnv(opts: SpawnOptions | SpawnBackgroundOptions, childDepth: number): NodeJS.ProcessEnv {
	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		...(opts.envOverrides ?? {}),
		[SUBAGENT_DEPTH_ENV]: String(childDepth),
	};
	// Strip the parent's approval-mode flag — see doc comment above.
	delete childEnv.CAVE_APPROVAL_MODE;
	if (opts.agent.omitClaudeMd === true) childEnv.CAVE_OMIT_CLAUDE_MD = "1";
	return childEnv;
}

async function spawnSubagent(opts: SpawnOptions): Promise<SpawnResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	const effectiveModel = opts.resolveModel ? opts.resolveModel(opts.agent.model) : opts.agent.model;
	if (effectiveModel) args.push("--model", effectiveModel);
	// Tool scoping: resolve `tools:` (allow-list) and `disallowedTools:` (deny-list)
	// into the child's allow-list-only `--tools` flag. See computeChildToolsArg.
	const childTools = computeChildToolsArg(opts.agent);
	if (childTools) args.push("--tools", childTools);
	if (typeof opts.agent.effort === "string" && VALID_EFFORT_LEVELS.has(opts.agent.effort)) {
		args.push("--thinking", opts.agent.effort);
	}
	if (typeof opts.agent.maxTurns === "number" && opts.agent.maxTurns > 0) {
		args.push("--max-turns", String(Math.floor(opts.agent.maxTurns)));
	}

	let tmpDir: string | null = null;
	let promptPath: string | null = null;
	if (opts.agent.prompt?.trim()) {
		tmpDir = mkdtempSync(join(tmpdir(), "cave-subagent-"));
		promptPath = join(tmpDir, `${opts.agent.name}.md`);
		writeFileSync(promptPath, opts.agent.prompt, { encoding: "utf-8", mode: 0o600 });
		args.push("--append-system-prompt", promptPath);
	}

	args.push(`Task: ${opts.task}`);

	const invocation = resolveCaveInvocation(args, opts.caveBin);
	const spawner = opts.mockSpawn ?? spawn;

	let stdout = "";
	let stderr = "";
	let finalText = "";

	const childDepth = currentSubagentDepth() + 1;
	const childEnv = buildChildEnv(opts, childDepth);

	const exitCode = await new Promise<number>((resolve) => {
		const child = spawner(invocation.command, invocation.args, {
			cwd: opts.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: childEnv,
		});
		let buf = "";
		const subagentId = opts.subagentId ?? opts.agent.name;
		const emitProgress = (phase: SubagentProgressEvent["phase"], detail?: string) => {
			opts.onProgress?.({
				subagentName: opts.agent.name,
				subagentId,
				phase,
				detail,
			});
		};
		emitProgress("started", opts.task.slice(0, 80));
		const flushLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
					emitProgress("tool", event.toolName);
				} else if (event.type === "message_end" && event.message?.role === "assistant") {
					const content = event.message.content;
					if (Array.isArray(content)) {
						const textParts = content
							.filter((part) => part?.type === "text" && typeof part.text === "string")
							.map((part) => part.text as string);
						if (textParts.length > 0) {
							finalText = textParts.join("\n");
						}
					}
					if (typeof finalText === "string" && finalText.length > 0) {
						emitProgress("message", finalText.slice(0, 80));
					}
				}
			} catch {
				/* ignore non-JSON line */
			}
		};
		child.stdout?.on("data", (chunk: Buffer) => {
			const s = chunk.toString("utf-8");
			stdout += s;
			buf += s;
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const ln of lines) flushLine(ln);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8");
		});
		child.on("close", (code: number | null) => {
			if (buf.trim()) flushLine(buf);
			emitProgress(code === 0 || code === null ? "completed" : "failed", `exit ${code ?? 0}`);
			resolve(code ?? 0);
		});
		child.on("error", () => {
			emitProgress("failed", "spawn error");
			resolve(1);
		});
		if (opts.signal) {
			const kill = () => {
				try {
					child.kill("SIGTERM");
				} catch {
					/* ignore */
				}
				setTimeout(() => {
					try {
						if (!child.killed) child.kill("SIGKILL");
					} catch {
						/* ignore */
					}
				}, SIGKILL_GRACE_MS);
			};
			if (opts.signal.aborted) kill();
			else opts.signal.addEventListener("abort", kill, { once: true });
		}
	});

	if (promptPath) {
		try {
			rmSync(promptPath);
		} catch {
			/* ignore */
		}
	}
	if (tmpDir) {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}

	return { exitCode, stdout, stderr, finalText };
}

// ─── Background (async) subagent dispatch ────────────────────────────────

interface SpawnBackgroundOptions extends Omit<SpawnOptions, "signal"> {
	/** Optional addressable name to register in the subagent registry. */
	name?: string;
	/**
	 * Abort signal tied to the parent tool call / session. On abort we terminate
	 * the detached child (SIGTERM → SIGKILL escalation) and tear down the output
	 * write stream so a long-lived parent does not leak the orphan process or its
	 * file descriptor. Mirrors the foreground abort path in `spawnSubagent`.
	 */
	signal?: AbortSignal;
}

/**
 * Spawn a cave child detached and return immediately. JSONL events are
 * tee'd to a per-agentId output file under `~/.cave/tasks/{agentId}/`.
 *
 * Mirrors claude-code Task.ts:108-125 — the parent reads the output file
 * (via Read or `tail`) to learn what the child has done so far.
 */
function spawnSubagentBackground(opts: SpawnBackgroundOptions): {
	agentId: string;
	outputFile: string;
	entry: BackgroundSubagent;
} {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	const effectiveModel = opts.resolveModel ? opts.resolveModel(opts.agent.model) : opts.agent.model;
	if (effectiveModel) args.push("--model", effectiveModel);
	// Tool scoping: same allow-list/deny-list resolution as the foreground path.
	const childTools = computeChildToolsArg(opts.agent);
	if (childTools) args.push("--tools", childTools);
	if (typeof opts.agent.effort === "string" && VALID_EFFORT_LEVELS.has(opts.agent.effort)) {
		args.push("--thinking", opts.agent.effort);
	}
	if (typeof opts.agent.maxTurns === "number" && opts.agent.maxTurns > 0) {
		args.push("--max-turns", String(Math.floor(opts.agent.maxTurns)));
	}

	let tmpDir: string | null = null;
	let promptPath: string | null = null;
	if (opts.agent.prompt?.trim()) {
		tmpDir = mkdtempSync(join(tmpdir(), "cave-subagent-"));
		promptPath = join(tmpDir, `${opts.agent.name}.md`);
		writeFileSync(promptPath, opts.agent.prompt, { encoding: "utf-8", mode: 0o600 });
		args.push("--append-system-prompt", promptPath);
	}
	args.push(`Task: ${opts.task}`);

	const subagentId = opts.subagentId ?? `${opts.agent.name}-${Date.now().toString(36)}`;
	const outputFile = getTaskOutputPath(subagentId);
	const out = createWriteStream(outputFile, { flags: "w", mode: 0o600 });

	const invocation = resolveCaveInvocation(args, opts.caveBin);
	const childDepth = currentSubagentDepth() + 1;
	// #41: strip CAVE_APPROVAL_MODE so the (TTY-less) background child runs
	// autopilot — the parent's task spawn was already approval-gated. See
	// buildChildEnv.
	const childEnv = buildChildEnv(opts, childDepth);

	const spawner = opts.mockSpawn ?? spawn;
	const child = spawner(invocation.command, invocation.args, {
		cwd: opts.cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
		env: childEnv,
		detached: false,
	});
	child.unref?.();

	const entry: BackgroundSubagent = {
		agentId: subagentId,
		name: opts.name,
		subagentName: opts.agent.name,
		task: opts.task,
		startedAt: Date.now(),
		status: "running",
		outputFile,
		mailbox: [],
		child,
	};
	registerBackground(entry);

	child.stdout?.on("data", (chunk: Buffer) => {
		out.write(chunk);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		// Forward stderr to the same file with a `stderr:` prefix per line so the
		// reader can distinguish stream sources without a second file.
		const text = chunk.toString("utf-8");
		for (const line of text.split("\n")) {
			if (line.length > 0) out.write(`stderr: ${line}\n`);
		}
	});
	child.on("close", (code: number | null) => {
		const exitCode = code ?? 0;
		out.end();
		updateBackground(subagentId, {
			status: exitCode === 0 ? "completed" : "failed",
			exitCode,
			finishedAt: Date.now(),
			child: undefined,
		});
		if (promptPath) {
			try {
				rmSync(promptPath);
			} catch {}
		}
		if (tmpDir) {
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch {}
		}
	});
	child.on("error", () => {
		out.end();
		updateBackground(subagentId, {
			status: "failed",
			exitCode: 1,
			finishedAt: Date.now(),
			child: undefined,
		});
	});

	// Abort handling — mirrors the foreground path in `spawnSubagent` (SIGTERM,
	// then SIGKILL after a grace period). A background subagent is detached and
	// `unref()`'d so it can outlive the synchronous tool call; without honoring
	// the parent's AbortSignal an aborted/disposed parent leaves an uncancellable
	// orphan process plus the leaked `createWriteStream` FD. On abort we kill the
	// child and close the stream so both the process and the descriptor are freed.
	if (opts.signal) {
		let escalation: NodeJS.Timeout | undefined;
		// Closing the stream on abort releases the FD even if the child never
		// emits `close` (e.g. it ignored SIGTERM and we had to SIGKILL, or it was
		// already dead). `!writableEnded` guards against a double-end.
		const closeStream = () => {
			if (!out.writableEnded) out.end();
		};
		const kill = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			escalation = setTimeout(() => {
				try {
					if (!child.killed) child.kill("SIGKILL");
				} catch {
					/* ignore */
				}
				closeStream();
			}, SIGKILL_GRACE_MS);
			// Don't let the escalation timer keep the parent event loop alive.
			escalation.unref?.();
		};
		// If the child exits on its own (SIGTERM honored, or normal completion),
		// cancel the pending SIGKILL escalation, release the stream, AND remove
		// the abort listener. The `{ once: true }` below only auto-removes the
		// listener when abort FIRES; on the common normal-exit path it would
		// otherwise linger on the signal forever, holding closures over
		// `child`/`out`/`escalation` — the exact leak class #17 fixes.
		child.once("close", () => {
			if (escalation) clearTimeout(escalation);
			closeStream();
			opts.signal?.removeEventListener("abort", kill);
		});
		if (opts.signal.aborted) kill();
		else opts.signal.addEventListener("abort", kill, { once: true });
	}

	return { agentId: subagentId, outputFile, entry };
}

// ─── Worktree isolation orchestration ─────────────────────────────────────

async function maybeCreateWorktree(
	def: SubagentDef,
	parentCwd: string,
	id: string,
): Promise<{ cwd: string; worktree?: CreateWorktreeResult }> {
	if (def.isolation !== "worktree") return { cwd: parentCwd };
	const repoRoot = await detectRepoRoot(parentCwd);
	if (!repoRoot) {
		// Outside a git repo — silently fall back to shared cwd.
		return { cwd: parentCwd };
	}
	try {
		const wt = await createWorktree({ repoRoot, id, configDirName: CONFIG_DIR_NAME });
		return { cwd: wt.worktreeDir, worktree: wt };
	} catch {
		// Fall back to shared cwd if worktree creation fails (e.g. offline mirror).
		return { cwd: parentCwd };
	}
}

async function maybeCleanupWorktree(
	parentCwd: string,
	worktree: CreateWorktreeResult | undefined,
): Promise<boolean | undefined> {
	if (!worktree) return undefined;
	const repoRoot = await detectRepoRoot(parentCwd);
	if (!repoRoot) return undefined;
	const result = await autoCleanupWorktree({
		repoRoot,
		worktreeDir: worktree.worktreeDir,
		branchName: worktree.branchName,
		baseRef: worktree.baseRef,
	});
	return result.cleaned;
}

// ─── Single agent invocation core (used by all 3 modes) ───────────────────

async function runOne(
	loaded: LoadAgentDefsResult,
	agentName: string,
	task: string,
	parentCwd: string,
	cwdOverride: string | undefined,
	signal: AbortSignal | undefined,
	options: {
		caveBin?: string;
		mockSpawn?: typeof spawn;
		idSuffix?: string;
		resolveModel?: SpawnOptions["resolveModel"];
		envOverrides?: SpawnOptions["envOverrides"];
		onProgress?: SubagentProgressCallback;
		/**
		 * Correlation id for `subagent_progress` events. Threaded down from the
		 * task tool's `toolCallId` so the emitted `subagentId` matches the tool
		 * row the parent created at `tool_execution_start` (DD §11.1 B1). When
		 * unset, falls back to the internally-minted worktree id.
		 */
		subagentId?: string;
		/** Per-call override for the agent's frontmatter model. */
		modelOverride?: string;
		/** Per-call chat-mode override (plan = read-only, auto = full). */
		modeOverride?: "plan" | "auto";
	} = {},
): Promise<SubagentResult> {
	const found = findAgentDef(loaded, agentName);
	if (!found) {
		return {
			agent: agentName,
			source: "user",
			task,
			output: "",
			exitCode: 1,
			error: `Unknown agent "${agentName}".\nAvailable:\n${formatAgentList(loaded)}`,
		};
	}
	const id = sanitizeId(`${agentName}-${Date.now().toString(36)}${options.idSuffix ? `-${options.idSuffix}` : ""}`);
	const wt = await maybeCreateWorktree(found.def, cwdOverride ?? parentCwd, id);
	const startCwd = wt.cwd;

	const effectiveDef: SubagentDef = options.modelOverride ? { ...found.def, model: options.modelOverride } : found.def;
	const childEnvForMode: Record<string, string> | undefined = options.modeOverride
		? { ...(options.envOverrides ?? {}), CAVE_CHAT_MODE: options.modeOverride }
		: options.envOverrides;

	let spawnRes: SpawnResult;
	try {
		spawnRes = await spawnSubagent({
			cwd: startCwd,
			agent: effectiveDef,
			task,
			signal,
			caveBin: options.caveBin,
			mockSpawn: options.mockSpawn,
			resolveModel: options.resolveModel,
			envOverrides: childEnvForMode,
			subagentId: options.subagentId ?? id,
			onProgress: options.onProgress,
		});
	} catch (err) {
		const cleaned = await maybeCleanupWorktree(parentCwd, wt.worktree);
		return {
			agent: agentName,
			source: found.def.source,
			task,
			output: "",
			exitCode: 1,
			error: (err as Error).message,
			worktreeDir: wt.worktree?.worktreeDir,
			branchName: wt.worktree?.branchName,
			worktreeCleaned: cleaned,
		};
	}

	const cleaned = await maybeCleanupWorktree(parentCwd, wt.worktree);

	// Optional: if the agent declared an outputSchema, parse finalText as JSON
	// and validate. Failure surfaces as an error so the parent session can
	// retry with a clarifying message instead of silently passing bad data on.
	let parsedData: unknown;
	let validationError: string | undefined;
	const schemaDef = found.def as SubagentDefWithOutputSchema;
	if (schemaDef.outputSchema && spawnRes.exitCode === 0 && spawnRes.finalText.trim()) {
		try {
			parsedData = JSON.parse(spawnRes.finalText);
		} catch {
			validationError = "outputSchema set but agent did not return valid JSON";
		}
		if (!validationError) {
			const result = validateSubagentOutput(found.def, parsedData);
			if (!result.ok) {
				validationError = `outputSchema violation:\n  ${result.errors.join("\n  ")}`;
			}
		}
	}

	return {
		agent: agentName,
		source: found.def.source,
		task,
		output: spawnRes.finalText,
		exitCode: validationError ? 2 : spawnRes.exitCode,
		error:
			validationError ??
			(spawnRes.exitCode !== 0 ? spawnRes.stderr.trim() || `exit ${spawnRes.exitCode}` : undefined),
		data: parsedData,
		worktreeDir: wt.worktree?.worktreeDir,
		branchName: wt.worktree?.branchName,
		worktreeCleaned: cleaned,
	};
}

// ─── Concurrency-limited mapper ───────────────────────────────────────────

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
	if (items.length === 0) return [];
	const cap = Math.max(1, Math.min(limit, items.length));
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = new Array(cap).fill(0).map(async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

// ─── Tool factory ─────────────────────────────────────────────────────────

export interface TaskToolOptions {
	/** Override the cave binary used to spawn subagents. */
	caveBin?: string;
	/** Inject a fake spawner for tests. */
	mockSpawn?: typeof spawn;
	/** Override the loader (test injection). */
	loader?: () => LoadAgentDefsResult;
	/**
	 * Per-event progress sink. Invoked for every JSON event the spawned cave
	 * child emits — used by AgentSession to forward `subagent_progress` events
	 * to the TUI so users see live activity instead of silence until exit.
	 */
	onProgress?: SubagentProgressCallback;
	/**
	 * Resolve which model the spawned cave child should use.
	 *
	 * Receives the agent's frontmatter `model` (may be undefined) and returns
	 * a model id to pass via `--model`, or `undefined` to drop the flag and
	 * let the child cave use its settings default.
	 *
	 * The standard wiring (in agent-session.ts) returns the agent's preferred
	 * model when the parent has auth for it, otherwise falls back to the
	 * parent's currently-running model — that way users on a non-Anthropic
	 * provider can still invoke agents whose .md files pin a Claude tier.
	 */
	resolveModel?: SpawnOptions["resolveModel"];
	/**
	 * Env vars to merge into each spawned subagent's environment. Wired from
	 * the parent's `AuthStorage.getRuntimeApiKeys()` so credentials set via
	 * `--api-key` (in-memory only) reach the child cave.
	 */
	envOverrides?: SpawnOptions["envOverrides"];
	/**
	 * Returns the list of MCP server names currently available to the parent.
	 * When set, agents whose `requiredMcpServers` are not satisfied are hidden
	 * from the model and refused at invocation time.
	 * Reference: claude-code AgentTool.tsx:367-407.
	 */
	getAvailableMcpServers?: () => string[];
}

export function createTaskToolDefinition(
	cwd: string,
	options?: TaskToolOptions,
): ToolDefinition<typeof TaskSchema, TaskToolDetails | undefined> {
	const baseLoader = options?.loader ?? (() => loadAgentDefs({ cwd }));
	const loader = (): LoadAgentDefsResult => {
		const loaded = baseLoader();
		const available = options?.getAvailableMcpServers?.();
		if (!available) return loaded;
		return filterAgentsByMcpAvailability(loaded, available);
	};

	// Render the agent menu into the tool's description so the model sees it
	// in the tool spec, not just in the registry. Without this, the model has
	// no idea which agents exist and falls back to running grep/find itself.
	const loadedAtBuild = (() => {
		try {
			return loader();
		} catch {
			return { agents: [], diagnostics: [] } as LoadAgentDefsResult;
		}
	})();
	const agentMenu =
		loadedAtBuild.agents.length === 0
			? ""
			: `\n\nAvailable agent types and what they do:\n${loadedAtBuild.agents
					.map((a) => `  - ${a.def.name}: ${a.def.description}`)
					.join("\n")}`;

	return {
		name: "task",
		label: "Task",
		description: [
			"Launch a subagent for delegated work. Each agent type has a specialized role and (often) its own tool subset, model tier, and permission mode.",
			"Use this WHEN: the work is exploratory or research-heavy (prefer the `explore` agent over running grep/find/read manually); the work is a multi-step task that benefits from a focused subagent (review, critique, test-writing); independent units of work can run in parallel.",
			"Do NOT use for: trivial single-file lookups where one Read or Grep would do; tasks the parent is already in the middle of and needs synchronous control over.",
			`Modes (exactly one per call): single (agent + task), parallel (tasks: [{agent,task}], up to ${MAX_PARALLEL_SUBAGENTS}), chain (chain: [{agent,task}], "{previous}" substituted with prior step's output).`,
			"Subagents inherit cwd; agents with `isolation: worktree` run in a fresh git worktree. Plan-mode agents are read-only.",
			agentMenu,
		].join(" "),
		promptSnippet:
			"Delegate to a subagent (use `explore` for codebase reconnaissance instead of running grep/find yourself)",
		promptGuidelines: [
			"For codebase exploration ('where is X', 'how does Y work', 'what files touch Z'), prefer launching the `explore` subagent over running grep/find/read sequentially yourself.",
			"For independent units of work, launch them in parallel via `task({ tasks: [...] })` rather than serially.",
			"Always pick the most specific agent for the job; fall back to `explore` only when no specialist fits.",
		],
		parameters: TaskSchema,
		async execute(toolCallId, params: TaskToolInput, signal) {
			if (currentSubagentDepth() >= MAX_SUBAGENT_DEPTH) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Task tool refused: subagent recursion depth ${currentSubagentDepth()} ≥ cap ${MAX_SUBAGENT_DEPTH}. ` +
								`Subagents may not chain Task calls beyond ${MAX_SUBAGENT_DEPTH} levels deep.`,
						},
					],
					details: undefined,
				};
			}
			const loaded = loader();
			const hasSingle = !!(params.agent && params.task);
			const hasParallel = !!(params.tasks && params.tasks.length > 0);
			const hasChain = !!(params.chain && params.chain.length > 0);
			const modeCount = (hasSingle ? 1 : 0) + (hasParallel ? 1 : 0) + (hasChain ? 1 : 0);
			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Task tool requires EXACTLY one of: agent+task / tasks / chain.\n` +
								`Available agents:\n${formatAgentList(loaded)}`,
						},
					],
					details: undefined,
				};
			}

			if (hasParallel && params.tasks!.length > MAX_PARALLEL_SUBAGENTS) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Task tool: too many parallel tasks (${params.tasks!.length}). Maximum is ${MAX_PARALLEL_SUBAGENTS}.`,
						},
					],
					details: { mode: "parallel" as const, results: [] },
				};
			}

			if (hasSingle) {
				// Async dispatch path — when the agent declares `background: true`
				// (or per-call `background: true`), spawn detached and return
				// immediately with `{agentId, outputFile}`. The parent uses the
				// `task_status` / `read` tools to poll progress.
				const def = findAgentDef(loaded, params.agent!)?.def;
				if (def?.background === true) {
					const { agentId, outputFile, entry } = spawnSubagentBackground({
						cwd: params.cwd ?? cwd,
						agent: params.model ? { ...def, model: params.model } : def,
						task: params.task!,
						caveBin: options?.caveBin,
						mockSpawn: options?.mockSpawn,
						resolveModel: options?.resolveModel,
						envOverrides: params.mode
							? { ...(options?.envOverrides ?? {}), CAVE_CHAT_MODE: params.mode }
							: options?.envOverrides,
						signal,
					});
					return {
						content: [
							{
								type: "text" as const,
								text:
									`Subagent "${def.name}" launched in background.\n` +
									`agentId: ${agentId}\n` +
									`outputFile: ${outputFile}\n` +
									`Use the \`read\` tool on outputFile to inspect progress, or \`send_message\` to steer.`,
							},
						],
						details: {
							mode: "async_launched" as const,
							results: [],
							asyncLaunches: [
								{
									agentId,
									subagentName: entry.subagentName,
									outputFile,
								},
							],
						},
					};
				}

				const r = await runOne(loaded, params.agent!, params.task!, cwd, params.cwd, signal, {
					caveBin: options?.caveBin,
					mockSpawn: options?.mockSpawn,
					resolveModel: options?.resolveModel,
					envOverrides: options?.envOverrides,
					onProgress: options?.onProgress,
					// Single subagent under this task call → correlate progress directly
					// to the tool row (DD §11.1 B1).
					subagentId: toolCallId,
					modelOverride: params.model,
					modeOverride: params.mode,
				});
				const text =
					r.exitCode === 0
						? truncateParentResult(r.output || "(no output)")
						: `Subagent failed:\n${truncateParentResult(subagentResultBody(r))}`;
				return {
					content: [{ type: "text" as const, text }],
					details: { mode: "single" as const, results: [r] },
				};
			}

			if (hasParallel) {
				const results = await mapWithLimit(params.tasks!, MAX_CONCURRENCY, (t, idx) =>
					runOne(loaded, t.agent, t.task, cwd, t.cwd, signal, {
						caveBin: options?.caveBin,
						mockSpawn: options?.mockSpawn,
						idSuffix: String(idx),
						resolveModel: options?.resolveModel,
						envOverrides: options?.envOverrides,
						onProgress: options?.onProgress,
						// N subagents under ONE task call → stable per-index id derived
						// from the tool row (DD §11.1 B1).
						subagentId: `${toolCallId}#${idx}`,
						modelOverride: t.model,
						modeOverride: t.mode,
					}),
				);
				const ok = results.filter((r) => r.exitCode === 0).length;
				const perResultMax = Math.max(
					MIN_PARALLEL_RESULT_CHARS,
					Math.floor(MAX_PARALLEL_PARENT_RESULT_CHARS / Math.max(1, results.length)),
				);
				const summary = results.map((r) => formatSubagentResultForParent(r, perResultMax));
				return {
					content: [
						{
							type: "text" as const,
							text: `Parallel: ${ok}/${results.length} succeeded\n\n${summary.join("\n\n")}`,
						},
					],
					details: { mode: "parallel" as const, results },
				};
			}

			// chain
			const results: SubagentResult[] = [];
			let prev = "";
			for (let i = 0; i < params.chain!.length; i++) {
				const step = params.chain![i];
				const taskWithPrev = step.task.replace(/\{previous\}/g, prev);
				const r = await runOne(loaded, step.agent, taskWithPrev, cwd, step.cwd, signal, {
					caveBin: options?.caveBin,
					mockSpawn: options?.mockSpawn,
					idSuffix: `chain-${i}`,
					resolveModel: options?.resolveModel,
					envOverrides: options?.envOverrides,
					onProgress: options?.onProgress,
					// Sequential steps under ONE task call → stable per-index id
					// derived from the tool row (DD §11.1 B1).
					subagentId: `${toolCallId}#${i}`,
					modelOverride: step.model,
					modeOverride: step.mode,
				});
				results.push(r);
				if (r.exitCode !== 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Chain stopped at step ${i + 1} (${step.agent}):\n${truncateParentResult(subagentResultBody(r))}`,
							},
						],
						details: { mode: "chain" as const, results },
					};
				}
				prev = r.output;
			}
			const last = results[results.length - 1];
			return {
				content: [{ type: "text" as const, text: truncateParentResult(last?.output || "(no output)") }],
				details: { mode: "chain" as const, results },
			};
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("task "));
			if (args.chain && args.chain.length > 0) {
				text += theme.fg("accent", `chain (${args.chain.length} steps)`);
			} else if (args.tasks && args.tasks.length > 0) {
				text += theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
			} else if (args.agent) {
				text += theme.fg("accent", args.agent);
				const preview = args.task ? args.task.slice(0, 60) : "...";
				text += theme.fg("dim", ` ${preview}`);
			} else {
				text += theme.fg("dim", "(invalid)");
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TaskToolDetails | undefined;
			if (!details || details.results.length === 0) {
				const c = result.content[0];
				return new Text(c?.type === "text" ? c.text : "(no output)", 0, 0);
			}
			const ok = details.results.filter((r) => r.exitCode === 0).length;
			const head = `${theme.fg(ok === details.results.length ? "success" : "error", "task")} ${theme.fg(
				"toolOutput",
				`${ok}/${details.results.length}`,
			)}`;
			const lines = details.results.map((r) => {
				const icon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
				return `${icon} ${theme.fg("accent", r.agent)} ${theme.fg("dim", r.output.slice(0, 80))}`;
			});
			return new Text([head, ...lines].join("\n"), 0, 0);
		},
	};
}

export const taskToolDefinition = createTaskToolDefinition(process.cwd());

// Re-export the schema type for callers.
export { TaskSchema };
