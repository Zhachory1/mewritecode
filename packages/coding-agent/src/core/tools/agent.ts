/**
 * `Agent` built-in tool — simpler single-shot wrapper around the Task tool.
 *
 * Where Task is the fan-out/chain orchestrator, Agent is "run one named
 * agent on this task" — useful for skills and slash commands that always
 * invoke exactly one agent. The implementation delegates to Task's `single`
 * mode so behaviour stays identical.
 */

import type { SubagentResult } from "@caveman-code/agent";
import { Text } from "@caveman-code/tui";
import { type Static, Type } from "@sinclair/typebox";
import { type LoadAgentDefsResult, loadAgentDefs } from "../agent-defs/loader.js";
import type { ToolDefinition } from "../extensions/types.js";
import { createTaskToolDefinition, type TaskToolOptions } from "./task.js";

const AgentSchema = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke (must exist in .cave/agents/)" }),
	task: Type.String({ description: "Task description handed to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Override working directory" })),
});

export type AgentToolInput = Static<typeof AgentSchema>;

export interface AgentToolDetails {
	result: SubagentResult;
}

export interface AgentToolOptions extends TaskToolOptions {}

export function createAgentToolDefinition(
	cwd: string,
	options?: AgentToolOptions,
): ToolDefinition<typeof AgentSchema, AgentToolDetails | undefined> {
	const taskTool = createTaskToolDefinition(cwd, options);

	// Same dynamic-menu trick as `task`: render the agent list into the
	// description so the model picks from a real menu instead of guessing.
	const loader = options?.loader ?? (() => loadAgentDefs({ cwd }));
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
		name: "agent",
		label: "Agent",
		description: [
			"Invoke a single named subagent on a task. Use this when delegating to a specialist (e.g. the `explore` agent for codebase reconnaissance instead of running grep/find/read manually).",
			"For parallel fan-out across multiple agents, use the `task` tool with `tasks: [...]` instead.",
			"Subagent definitions live at `.cave/agents/<name>.md`; bundled defaults ship with cave.",
			agentMenu,
		].join(" "),
		promptSnippet: "Invoke one named subagent (prefer `explore` over manual grep for codebase questions)",
		parameters: AgentSchema,
		async execute(id, params: AgentToolInput, signal, _onUpdate, ctx) {
			// Delegate to Task's single mode.
			const taskResult = await taskTool.execute(
				id,
				{ agent: params.agent, task: params.task, cwd: params.cwd },
				signal,
				undefined,
				ctx as any,
			);
			const details = (taskResult.details as { mode: string; results: SubagentResult[] } | undefined) ?? undefined;
			const single = details?.results[0];
			return {
				content: taskResult.content,
				details: single ? { result: single } : undefined,
			};
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("agent "));
			text += theme.fg("accent", args.agent || "...");
			if (args.task) text += theme.fg("dim", ` ${args.task.slice(0, 60)}`);
			return new Text(text, 0, 0);
		},
		renderResult(result, _opt, theme) {
			const details = result.details as AgentToolDetails | undefined;
			if (!details) {
				const c = result.content[0];
				return new Text(c?.type === "text" ? c.text : "(no output)", 0, 0);
			}
			const r = details.result;
			const icon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
			return new Text(`${icon} ${theme.fg("accent", r.agent)} ${theme.fg("dim", r.output.slice(0, 200))}`, 0, 0);
		},
	};
}

export const agentToolDefinition = createAgentToolDefinition(process.cwd());

export { AgentSchema };
