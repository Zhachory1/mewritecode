/**
 * Tool-name constants — a LEAF module with zero runtime imports.
 *
 * These live apart from `index.ts` on purpose: `index.ts` instantiates the tool
 * runtime at module-eval time (taskTool/agentTool bind `process.cwd()` and load
 * the agent registry), so importing it just to read the tool NAMES created a
 * circular import (loader → tool-name-check → index). Keeping the names here —
 * a plain compile-time constant — breaks the cycle structurally; consumers
 * (tool-name-check, loader) import this leaf, never the heavy runtime module.
 *
 * `VALID_TOOL_NAMES` MUST stay in sync with `Object.keys(allTools)` in index.ts.
 * A drift-guard test asserts the two sets are identical, so adding a tool there
 * without updating this list fails CI.
 */

/** Canonical built-in tool names — exactly the set the child CLI accepts (`name in allTools`, args.ts:118). */
export const VALID_TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"clarify",
	"task",
	"agent",
	"send_message",
	"task_status",
] as const;

/** Prefixes for tools registered at runtime (memory layer, MCP servers). A name with one of
 *  these (plus a non-empty segment after it) is plausibly real and must NOT be warned about.
 *  Skills attach via the separate `skills:` frontmatter field, not `tools:`. */
export const DYNAMIC_TOOL_PREFIXES = ["mcp__", "memory_"] as const;
