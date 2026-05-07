---
title: Subagents
description: Worktree-isolated parallel agents dispatched via the Task tool.
---

# Subagents

A subagent is a child Cave process with its own context window, tool allowlist, and (optionally) git worktree. The parent dispatches via the `Task` or `Agent` built-in tool, and the subagent returns a structured ≤500-token summary.

<CopyForLlms />

## When to use

- Parallel exploration: spawn `Explore` agents to map four directories, gather results.
- Isolation: run `Implementer` agent on its own git worktree so the parent's index stays clean.
- Cost: route mechanical work (running tests, formatting) to a Haiku-class subagent while keeping the parent on Opus.

## Definition

`.cave/agents/explore.md`:

```markdown
---
description: "Read-only exploration of a directory. Returns a 500-token summary."
prompt: |
  Walk the directory at `$1`. List subdirectories with one-line purpose hints.
  Identify the entry points. Note any unusual config. Do NOT make edits.
tools: [Read, Glob, Grep, Bash]
disallowedTools: [Edit, Write]
model: claude-haiku-4
maxTurns: 8
isolation: none
---
```

For implementer-class agents, set `isolation: worktree` to spawn the agent in a fresh git worktree at `.cave/worktrees/<id>`. Worktrees are cleaned on agent exit unless `--keep-worktree`.

## Frontmatter

| Key | Purpose |
|---|---|
| `description` | Auto-loaded into the parent's context for `Task` tool dispatch |
| `prompt` | The agent's system prompt |
| `tools` | Allowed tools |
| `disallowedTools` | Denied tools (overrides `tools`) |
| `model` | Model for this agent |
| `mcpServers` | MCP servers exposed to this agent only |
| `hooks` | Hook overrides |
| `maxTurns` | Hard cap on agent turns |
| `skills` | Skill allowlist |
| `effort` | Thinking level |
| `background` | Run async; parent doesn't block |
| `isolation` | `worktree` or `none` |

## Default agents

| Agent | Purpose |
|---|---|
| `Explore` | Read-only directory exploration |
| `Reviewer` | Read the diff, return findings |
| `Tester` | Run the test suite, summarize failures |
| `Implementer` | Edit-class agent, runs in a worktree |
| `Critic` | Adversarial review of a proposed plan |

Override or extend in `.cave/agents/`.

## Dispatch from the parent

The model uses the `Task` tool:

```
Task: Explore the packages/agent and packages/coding-agent dirs in parallel.
Use the Explore subagent. Return a unified summary.
```

Or the user can dispatch manually:

```
/agent Explore packages/agent
```

Up to 7 subagents can run in parallel. The parent's TUI shows a live overlay (F2) with each subagent's current tool, token spend, and elapsed time.

## Result schema

Subagents return a structured payload:

```json
{
    "agent": "Explore",
    "summary": "string ≤500 tokens",
    "artifacts": [{ "type": "file", "path": "..." }],
    "metrics": { "turns": 5, "tokens_in": 12000, "tokens_out": 480, "cost": 0.012 }
}
```

The parent receives the `summary` only — full transcripts persist to `~/.cave/sessions/<id>.trace.jsonl`.

## Importing Claude Code agents

```bash
cp ~/.claude/agents/*.md ~/.cave/agents/
```

Frontmatter is a superset. Tool names match.
