# Permissions

Me Write Code defaults to direct local execution: tools can read files, edit files, and run shell commands according to the active approval/sandbox settings.

## Current support

| Capability | Status | Notes |
| --- | --- | --- |
| Plan mode | Shipped | `/plan` makes the current chat read-only; `/act` returns to normal tool use. |
| Approval mode | Shipped | When enabled, mutating tools and shell commands require interactive approval. |
| Checkpoints | Shipped | File edits can be checkpointed and rolled back from the TUI. |
| Native OS sandbox | Beta | Sandbox support depends on platform and launch mode; verify with `/doctor` before relying on it for untrusted code. |
| Subagent worktree isolation | Shipped | Agents with `isolation: worktree` run in a fresh git worktree. |

## Practical guidance

Use `/plan` before risky exploration, enable approval mode when working in unfamiliar repositories, and keep destructive shell commands behind explicit confirmation. Never run untrusted code solely because sandboxing is present; treat sandboxing as defense-in-depth, not the primary safety boundary.

## Related

- [Plan Mode](./plan-mode.md)
- [Subagents](./subagents.md)
- [Tools](./tools.md)
