// WS6: Task tool tests with a mocked spawner.
//
// We verify:
//   - parallel cap (>7 → rejected with helpful message)
//   - mode mutex (exactly one of single/parallel/chain required)
//   - single-mode end-to-end with a mocked subagent process
//   - chain-mode {previous} substitution
//   - unknown agent returns a structured error

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PARALLEL_SUBAGENTS } from "@zhachory1/mewrite-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentDefs } from "../src/core/agent-defs/loader.js";
import { filterToolsForPlanMode } from "../src/core/chat-modes/plan.js";
import { codingTools } from "../src/core/tools/index.js";
import { createTaskToolDefinition, type TaskToolDetails } from "../src/core/tools/task.js";

// ─── Mocked spawner that returns a JSON-mode message_end event ─────────────

interface FakeAgentResponse {
	finalText?: string;
	exitCode?: number;
	stderr?: string;
	delayMs?: number;
}

function makeMockSpawn(responses: Record<string, FakeAgentResponse>) {
	return ((_command: string, args: readonly string[]) => {
		// Find the prompt — the last positional arg (after `Task: `).
		const taskArg = args.find((a) => typeof a === "string" && a.startsWith("Task: "));
		const taskText = (taskArg ?? "").replace(/^Task: /, "");
		// Match by task substring; fall back to generic.
		let resp: FakeAgentResponse = { finalText: `echo: ${taskText}`, exitCode: 0 };
		for (const [k, v] of Object.entries(responses)) {
			if (taskText.includes(k)) {
				resp = v;
				break;
			}
		}

		const child = new EventEmitter() as ChildProcess & EventEmitter;
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		(child as any).stdout = stdout;
		(child as any).stderr = stderr;
		(child as any).kill = () => true;
		(child as any).killed = false;

		const delay = resp.delayMs ?? 5;
		setTimeout(() => {
			if (resp.finalText) {
				const event = `${JSON.stringify({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: resp.finalText }],
					},
				})}\n`;
				stdout.emit("data", Buffer.from(event));
			}
			if (resp.stderr) {
				stderr.emit("data", Buffer.from(resp.stderr));
			}
			child.emit("close", resp.exitCode ?? 0);
		}, delay);

		return child;
	}) as any;
}

// ─── Spawn-capturing mock (records args + env per child) ───────────────────
//
// The plain `makeMockSpawn` above ignores the spawn `opts` (env). Subagent
// write-access regressions (#41) hinge on BOTH the `--tools` allow-list args
// AND the child env (CAVE_APPROVAL_MODE strip, CAVE_CHAT_MODE plan flag), so
// this variant records the third spawn argument too.

interface CapturedSpawn {
	args: string[];
	env: NodeJS.ProcessEnv;
}

function makeCapturingSpawn(captured: CapturedSpawn[]) {
	return ((_command: string, args: readonly string[], opts?: { env?: NodeJS.ProcessEnv }) => {
		captured.push({ args: [...(args as string[])], env: opts?.env ?? {} });
		const child = new EventEmitter() as ChildProcess & EventEmitter;
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		(child as any).stdout = stdout;
		(child as any).stderr = stderr;
		(child as any).kill = () => true;
		(child as any).killed = false;
		(child as any).unref = () => {};
		setTimeout(() => {
			stdout.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({
						type: "message_end",
						message: { role: "assistant", content: [{ type: "text", text: "done" }] },
					})}\n`,
				),
			);
			child.emit("close", 0);
		}, 5);
		return child;
	}) as any;
}

/** Extract the value passed to `--tools` (the allow-list), or undefined if absent. */
function toolsArg(args: string[]): string | undefined {
	const i = args.indexOf("--tools");
	return i >= 0 ? args[i + 1] : undefined;
}

// ─── Test scaffolding ──────────────────────────────────────────────────────

let tmpRoot: string;
let cwd: string;
let userDir: string;
let packageDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cave-task-test-"));
	cwd = join(tmpRoot, "project");
	userDir = join(tmpRoot, "user-cave");
	packageDir = join(tmpRoot, "bundled-pkg");
	mkdirSync(join(cwd, ".cave", "agents"), { recursive: true });
	mkdirSync(join(userDir, "agents"), { recursive: true });
	mkdirSync(join(packageDir, "agents"), { recursive: true });

	// Seed two simple agents.
	writeFileSync(
		join(cwd, ".cave", "agents", "explore.md"),
		["---", "name: explore", "description: scout", "tools: read, grep", "---", "", "You are explore."].join("\n"),
	);
	writeFileSync(
		join(cwd, ".cave", "agents", "reviewer.md"),
		["---", "name: reviewer", "description: critique", "tools: read, grep", "---", "", "You are reviewer."].join(
			"\n",
		),
	);

	// Write-capable agent (#41): edit + write in its allow-list. Used to assert a
	// subagent can actually receive write tools / autopilot env.
	writeFileSync(
		join(cwd, ".cave", "agents", "implementer.md"),
		[
			"---",
			"name: implementer",
			"description: writes code",
			"tools: read, edit, write",
			"---",
			"",
			"You are implementer.",
		].join("\n"),
	);

	// Write-capable agent with one tool disallowed (allow-list + deny-list).
	writeFileSync(
		join(cwd, ".cave", "agents", "implementer-nobash.md"),
		[
			"---",
			"name: implementer-nobash",
			"description: writes code, no shell",
			"tools: read, edit, write, bash",
			"disallowedTools: bash",
			"---",
			"",
			"You are implementer-nobash.",
		].join("\n"),
	);

	// Agent with ONLY disallowedTools (no `tools:` allow-list). Pre-existing gap:
	// the deny-list was ignored unless `tools:` was also set (#41 finding).
	writeFileSync(
		join(cwd, ".cave", "agents", "denylist-only.md"),
		[
			"---",
			"name: denylist-only",
			"description: full tools minus bash",
			"disallowedTools: bash",
			"---",
			"",
			"You are denylist-only.",
		].join("\n"),
	);

	// Agent with no tool scoping at all → child should default to full write.
	writeFileSync(
		join(cwd, ".cave", "agents", "unscoped.md"),
		["---", "name: unscoped", "description: full access", "---", "", "You are unscoped."].join("\n"),
	);
});

afterEach(() => {
	if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeTool(mockSpawn: ReturnType<typeof makeMockSpawn>) {
	return createTaskToolDefinition(cwd, {
		mockSpawn,
		// Pin loader to the test dirs so the bundled defaults don't surprise us.
		loader: () =>
			loadAgentDefs({
				cwd,
				userDir,
				packageDir,
				skipBundled: true,
			}),
	});
}

describe("Task tool — mode mutex", () => {
	it("rejects when no mode is provided", async () => {
		const tool = makeTool(makeMockSpawn({}));
		const r = await tool.execute("id-1", {} as any, undefined, undefined, undefined as any);
		const text = (r.content[0] as any).text;
		expect(text).toContain("EXACTLY one of");
		expect(text).toContain("explore");
		expect(text).toContain("reviewer");
	});

	it("rejects when two modes are provided", async () => {
		const tool = makeTool(makeMockSpawn({}));
		const r = await tool.execute(
			"id-2",
			{ agent: "explore", task: "x", tasks: [{ agent: "explore", task: "y" }] } as any,
			undefined,
			undefined,
			undefined as any,
		);
		const text = (r.content[0] as any).text;
		expect(text).toContain("EXACTLY one of");
	});
});

describe("Task tool — parallel cap (plan §6: max 7)", () => {
	it("MAX_PARALLEL_SUBAGENTS exposed by @zhachory1/mewrite-agent equals 7", () => {
		expect(MAX_PARALLEL_SUBAGENTS).toBe(7);
	});

	it("rejects more than 7 parallel tasks with a clear message", async () => {
		const tool = makeTool(makeMockSpawn({}));
		const tooMany = new Array(8).fill(0).map((_, i) => ({ agent: "explore", task: `task ${i}` }));
		const r = await tool.execute("id-3", { tasks: tooMany } as any, undefined, undefined, undefined as any);
		const text = (r.content[0] as any).text;
		expect(text).toContain("too many parallel tasks (8)");
		expect(text).toContain("Maximum is 7");
	});

	it("accepts exactly 7 parallel tasks", async () => {
		const tool = makeTool(makeMockSpawn({}));
		const seven = new Array(7).fill(0).map((_, i) => ({ agent: "explore", task: `task ${i}` }));
		const r = await tool.execute("id-4", { tasks: seven } as any, undefined, undefined, undefined as any);
		const details = r.details as TaskToolDetails;
		expect(details.results).toHaveLength(7);
		expect(details.results.every((x) => x.exitCode === 0)).toBe(true);
	});
});

describe("Task tool — single-mode happy path (mocked LLM)", () => {
	it("invokes the agent and returns the final text", async () => {
		const mock = makeMockSpawn({ "explore me": { finalText: "## Files\n- foo.ts:1-10", exitCode: 0 } });
		const tool = makeTool(mock);
		const r = await tool.execute(
			"id-single",
			{ agent: "explore", task: "explore me" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		const text = (r.content[0] as any).text;
		expect(text).toContain("## Files");
		const details = r.details as TaskToolDetails;
		expect(details.mode).toBe("single");
		expect(details.results).toHaveLength(1);
		expect(details.results[0].agent).toBe("explore");
		expect(details.results[0].exitCode).toBe(0);
	});

	it("returns a structured error for unknown agent", async () => {
		const tool = makeTool(makeMockSpawn({}));
		const r = await tool.execute(
			"id-unknown",
			{ agent: "ghost", task: "hello" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		const details = r.details as TaskToolDetails;
		expect(details.results[0].exitCode).toBe(1);
		expect(details.results[0].error).toContain('Unknown agent "ghost"');
	});
});

describe("Task tool — subagent_progress correlation (DD §11.1 B1)", () => {
	it("single-mode emits progress ids equal to the toolCallId", async () => {
		const mock = makeMockSpawn({});
		const events: { subagentId: string; phase: string }[] = [];
		const tool = createTaskToolDefinition(cwd, {
			mockSpawn: mock,
			loader: () => loadAgentDefs({ cwd, userDir, packageDir, skipBundled: true }),
			onProgress: (e) => events.push({ subagentId: e.subagentId, phase: e.phase }),
		});
		await tool.execute(
			"tool-call-abc",
			{ agent: "explore", task: "explore me" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(events.length).toBeGreaterThan(0);
		// Single subagent → subagentId IS the toolCallId (no index suffix).
		expect(events.every((e) => e.subagentId === "tool-call-abc")).toBe(true);
		expect(events.some((e) => e.phase === "started")).toBe(true);
	});

	it("parallel-mode emits stable per-index ids prefixed by the toolCallId", async () => {
		const mock = makeMockSpawn({});
		const events: { subagentId: string; phase: string }[] = [];
		const tool = createTaskToolDefinition(cwd, {
			mockSpawn: mock,
			loader: () => loadAgentDefs({ cwd, userDir, packageDir, skipBundled: true }),
			onProgress: (e) => events.push({ subagentId: e.subagentId, phase: e.phase }),
		});
		await tool.execute(
			"tool-call-par",
			{
				tasks: [
					{ agent: "explore", task: "alpha" },
					{ agent: "reviewer", task: "beta" },
				],
			} as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(events.length).toBeGreaterThan(0);
		// Every id derivable from the tool call id; both indexed rows present.
		expect(events.every((e) => e.subagentId.startsWith("tool-call-par"))).toBe(true);
		const ids = new Set(events.map((e) => e.subagentId));
		expect(ids.has("tool-call-par#0")).toBe(true);
		expect(ids.has("tool-call-par#1")).toBe(true);
	});

	it("chain-mode emits stable per-step ids prefixed by the toolCallId", async () => {
		const mock = makeMockSpawn({});
		const events: { subagentId: string; phase: string }[] = [];
		const tool = createTaskToolDefinition(cwd, {
			mockSpawn: mock,
			loader: () => loadAgentDefs({ cwd, userDir, packageDir, skipBundled: true }),
			onProgress: (e) => events.push({ subagentId: e.subagentId, phase: e.phase }),
		});
		await tool.execute(
			"tool-call-chn",
			{
				chain: [
					{ agent: "explore", task: "step one" },
					{ agent: "reviewer", task: "review {previous}" },
				],
			} as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(events.length).toBeGreaterThan(0);
		expect(events.every((e) => e.subagentId.startsWith("tool-call-chn"))).toBe(true);
		const ids = new Set(events.map((e) => e.subagentId));
		expect(ids.has("tool-call-chn#0")).toBe(true);
		expect(ids.has("tool-call-chn#1")).toBe(true);
	});
});

describe("Task tool — chain-mode with {previous} substitution", () => {
	it("threads each step's output into the next via {previous}", async () => {
		const calls: string[] = [];
		const mock = ((_command: string, args: readonly string[]) => {
			const taskArg = args.find((a) => typeof a === "string" && a.startsWith("Task: ")) ?? "";
			const taskText = (taskArg as string).replace(/^Task: /, "");
			calls.push(taskText);

			const child = new EventEmitter() as any;
			const stdout = new EventEmitter();
			const stderr = new EventEmitter();
			child.stdout = stdout;
			child.stderr = stderr;
			child.kill = () => true;
			child.killed = false;

			setTimeout(() => {
				const text = `<from-${calls.length - 1}>${taskText}</from-${calls.length - 1}>`;
				stdout.emit(
					"data",
					Buffer.from(
						`${JSON.stringify({
							type: "message_end",
							message: { role: "assistant", content: [{ type: "text", text }] },
						})}\n`,
					),
				);
				child.emit("close", 0);
			}, 5);
			return child;
		}) as any;

		const tool = makeTool(mock);
		const r = await tool.execute(
			"id-chain",
			{
				chain: [
					{ agent: "explore", task: "step one" },
					{ agent: "reviewer", task: "review {previous}" },
				],
			} as any,
			undefined,
			undefined,
			undefined as any,
		);
		const details = r.details as TaskToolDetails;
		expect(details.mode).toBe("chain");
		expect(details.results).toHaveLength(2);
		// The second call's task text must include the first call's response.
		expect(calls[1]).toContain("review <from-0>step one</from-0>");
	});
});

// ─── #41: subagent write access — tool scoping + delegated approval ─────────
//
// Regression coverage for the silent-neuter bug: a write-capable subagent was
// receiving the parent's CAVE_APPROVAL_MODE env, but with no interactive TTY
// its approval gate denied every write/edit/bash → exit 0, zero work done.
// Plus the pre-existing disallowedTools gap (deny-list ignored when no
// `tools:` allow-list was set).

describe("Task tool — #41 subagent tool scoping", () => {
	it("write-capable agent (tools: read,edit,write) → child --tools includes edit + write", async () => {
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-impl",
			{ agent: "implementer", task: "write a file" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(captured).toHaveLength(1);
		const tools = toolsArg(captured[0].args);
		expect(tools).toBeDefined();
		const set = new Set((tools as string).split(","));
		expect(set.has("edit")).toBe(true);
		expect(set.has("write")).toBe(true);
		expect(set.has("read")).toBe(true);
	});

	it("disallowedTools: [bash] with tools: [...,bash] → bash absent from child --tools", async () => {
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-nobash",
			{ agent: "implementer-nobash", task: "write a file" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		const tools = toolsArg(captured[0].args);
		expect(tools).toBeDefined();
		const set = new Set((tools as string).split(","));
		expect(set.has("bash")).toBe(false);
		expect(set.has("edit")).toBe(true);
		expect(set.has("write")).toBe(true);
	});

	it("disallowedTools-only agent (no tools:) → child --tools = default codingTools minus disallowed", async () => {
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-deny",
			{ agent: "denylist-only", task: "write a file" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		const tools = toolsArg(captured[0].args);
		// GAP FIX: a deny-list with no allow-list must still constrain the child.
		expect(tools).toBeDefined();
		const set = new Set((tools as string).split(","));
		expect(set.has("bash")).toBe(false);
		// Remaining default coding tools survive (read/edit/write).
		expect(set.has("edit")).toBe(true);
		expect(set.has("write")).toBe(true);
	});

	it("no-tools agent def → no --tools flag (child defaults to full write)", async () => {
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-unscoped",
			{ agent: "unscoped", task: "do anything" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(toolsArg(captured[0].args)).toBeUndefined();
		expect(captured[0].args).not.toContain("--tools");
	});
});

describe("Task tool — #41 delegated approval (CAVE_APPROVAL_MODE strip)", () => {
	const KEY = "CAVE_APPROVAL_MODE";
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env[KEY];
	});
	afterEach(() => {
		if (prev === undefined) delete process.env[KEY];
		else process.env[KEY] = prev;
	});

	it("parent in approval mode → child env does NOT carry CAVE_APPROVAL_MODE", async () => {
		process.env[KEY] = "1";
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-approval",
			{ agent: "implementer", task: "write a file" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(captured).toHaveLength(1);
		// The spawn was already gated by the parent's beforeToolCall (task is not a
		// READ_ONLY_TOOL). Reaching the child means the delegation was approved, so
		// the child must run autopilot — NOT re-deny every write.
		expect(captured[0].env[KEY]).toBeUndefined();
	});

	it("background subagent in approval mode → child env does NOT carry CAVE_APPROVAL_MODE", async () => {
		process.env[KEY] = "1";
		writeFileSync(
			join(cwd, ".cave", "agents", "bg-impl.md"),
			[
				"---",
				"name: bg-impl",
				"description: background writer",
				"tools: read, edit, write",
				"background: true",
				"---",
				"",
				"You are bg-impl.",
			].join("\n"),
		);
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-bg-approval",
			{ agent: "bg-impl", task: "write a file" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(captured).toHaveLength(1);
		expect(captured[0].env[KEY]).toBeUndefined();
	});
});

describe("Task tool — #41 plan-mode subagent is read-only", () => {
	it("mode: plan sets CAVE_CHAT_MODE=plan and the plan filter drops edit/write", async () => {
		const captured: CapturedSpawn[] = [];
		const tool = makeTool(makeCapturingSpawn(captured));
		await tool.execute(
			"id-plan",
			{ agent: "implementer", task: "write a file", mode: "plan" } as any,
			undefined,
			undefined,
			undefined as any,
		);
		expect(captured).toHaveLength(1);
		// Plan gating happens in the CHILD via CAVE_CHAT_MODE → filterToolsForPlanMode.
		expect(captured[0].env.CAVE_CHAT_MODE).toBe("plan");
		// And the filter itself must strip write tools from the coding set.
		const filteredNames = new Set(filterToolsForPlanMode(codingTools).map((t) => t.name));
		expect(filteredNames.has("edit")).toBe(false);
		expect(filteredNames.has("write")).toBe(false);
		expect(filteredNames.has("read")).toBe(true);
	});
});
