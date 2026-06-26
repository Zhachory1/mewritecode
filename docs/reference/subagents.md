---
title: Subagents
description: Worktree-isolated parallel agents dispatched via the Task tool.
---

# Subagents

A subagent is a child Me Write Code process with its own context window, tool allowlist, and (optionally) git worktree. The parent dispatches via the `Task` or `Agent` built-in tool, and the subagent returns a structured ≤500-token summary.

<CopyForLlms />

## When to use

- Parallel exploration: spawn `Explore` agents to map four directories, gather results.
- Isolation: run `Implementer` agent on its own git worktree so the parent's index stays clean.
- Cost: route mechanical work (running tests, formatting) to a Haiku-class subagent while keeping the parent on Opus.

## Definition

`.mewrite/agents/explore.md`:

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

For implementer-class agents, set `isolation: worktree` to spawn the agent in a fresh git worktree at `.mewrite/worktrees/<id>`. Worktrees are cleaned on agent exit unless `--keep-worktree`.

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
| `Editor` | Apply a specific, already-decided edit in-place (no worktree) |

Override or extend in `.mewrite/agents/`.

## Giving a subagent write capability

A subagent can mutate files only if its `tools` allowlist includes write-class
tools. The minimal write toolset is:

```yaml
tools: read, grep, find, ls, edit, write
```

`edit` and `write` mutate; `read`, `grep`, `find`, and `ls` let the agent locate
and inspect a file before changing it. The loader emits a **warning** (never an
error) when an agent has `edit`/`write` but none of the locate tools — it can
mutate files it cannot first find. Unknown or mis-cased tool names are also
warned about (and otherwise silently dropped), so a typo in `tools:` is legible
rather than a silent no-op.

### In-place vs. worktree

| Mode | Frontmatter | Where edits land | Trade-off |
|---|---|---|---|
| In-place (default) | omit `isolation`, or `isolation: none` | The parent's working tree | No merge step. Use for small, concrete edits. |
| Isolated | `isolation: worktree` | A fresh `git worktree` at `.mewrite/worktrees/<id>` | Reviewable, parent index stays clean, but you must merge the worktree yourself. Use for larger or risky change sets. |

The bundled `Editor` agent ships in-place (no `isolation`) with a tight
description so it is dispatched only for concrete, already-decided edits. Set
`isolation: worktree` if you want an isolated, reviewable change instead (see
`Implementer`, which is worktree-isolated by default).

### `task` omission prevents fan-out

Omitting `task` (and `agent`) from an edit-class agent's `tools:` is intentional:
without those tools the agent **cannot spawn its own subagents**, so an editor or
implementer stays a single focused worker rather than fanning out into a tree of
nested agents.

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

Subagents return a structured envelope. The human-readable `output` remains the
short summary the model sees, while `observability` is durable metadata an
orchestrator can roll up without re-reading every worktree.

```json
{
  "agent": "Explore",
  "source": "builtin",
  "task": "Map packages/agent",
  "output": "string ≤500 tokens",
  "exitCode": 0,
  "observability": {
    "taskId": "repo-audit-17",
    "repoPath": "/work/repo",
    "phase": "test",
    "baseBranch": "main",
    "branchName": "fix/example",
    "filesChanged": ["src/example.ts"],
    "commands": [
      { "command": "npm test", "exitCode": 0, "durationMs": 1242 }
    ],
    "issues": ["https://github.com/org/repo/issues/123"],
    "prUrl": "https://github.com/org/repo/pull/456",
    "workingTreeClean": true,
    "artifactPath": "/tmp/subagent-progress.json",
    "blockers": []
  },
  "usage": { "turns": 5, "input": 12000, "output": 480, "cost": 0.012 }
}
```

Recommended `observability.phase` values are `plan`, `implement`, `test`,
`review`, `push`, `pr`, `done`, and `blocked`.

The parent receives `output` for model context and can separately render or
persist `observability` as a dashboard. Full transcripts persist to
`~/.mewrite/agent/sessions/<id>.trace.jsonl`.

## Importing Claude Code agents

```bash
cp ~/.claude/agents/*.md ~/.mewrite/agent/agents/
```

Frontmatter is a superset. Tool names match.
