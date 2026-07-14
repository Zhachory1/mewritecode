/**
 * Plan mode (Gap 2 of cave-v2 agent harness wire-up).
 *
 * Read-only exploration mode. The model sees only file-discovery tools and
 * produces a written plan. The user reviews the plan and types `/act` to flip
 * back into the normal `edit` mode where the agent can mutate files.
 *
 * Cave is autopilot — there is no permission dialog. The mode flip is the
 * approval gate. Plan mode also drops the gating system prompt suffix so the
 * model knows exactly what to produce.
 */

import type { AgentTool } from "@zhachory1/mewrite-agent";

export type ChatMode = "plan" | "edit" | "auto";

export const PLAN_MODE_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
	"read",
	"bash",
	"grep",
	"find",
	"ls",
	"glob",
	"questionnaire",
	"mcp_tool_search",
]);

export const PLAN_MODE_BANNER = `[PLAN MODE — read-only]
You are in plan mode. File-mutation tools (edit, write, task) are not available
this turn. Explore the code with read/grep/find. If the user or active task
provides an exact output schema, use that schema instead of the default plan
format below. Otherwise, produce a written plan under a "Plan:" header as a
numbered list of concrete operations:

  1. <operation> — <file> — <one-line rationale>
  2. <operation> — <file> — <one-line rationale>
  ...

Do NOT attempt to make changes. After you produce the plan, the user will
review it and either accept (running /act flips into edit mode) or refine.`;

/** Filter the tool list to plan-mode-allowed tools only. */
export function filterToolsForPlanMode<T extends AgentTool<any>>(tools: T[]): T[] {
	return tools.filter((t) => PLAN_MODE_TOOL_ALLOWLIST.has(t.name));
}

/** Append the plan banner to a base system prompt. */
export function planSystemPrompt(base: string): string {
	if (!base.trim()) return PLAN_MODE_BANNER;
	return `${base}\n\n${PLAN_MODE_BANNER}`;
}
