---
title: Hooks
description: 12-event lifecycle hooks. settings.json schema is identical to Claude Code.
---

# Hooks

Hooks are shell commands triggered by lifecycle events. Me Write Code uses the Claude Code hook schema, with Me Write Code config stored under `~/.mewrite/agent/`.

<CopyForLlms />

## Events

| Event | When fires | Sync? |
|---|---|---|
| `SessionStart` | Me Write Code session boots | sync, advisory |
| `SessionEnd` | Me Write Code exits | sync, advisory |
| `UserPromptSubmit` | User sends a turn | sync, advisory (stdout → context) |
| `Stop` | Model returns final response | sync, advisory |
| `SubagentStop` | A subagent returns to parent | sync, advisory |
| `PreToolUse` | Before any tool call | sync, advisory/input-mutating, 30s timeout |
| `PostToolUse` | After any tool call | async by default |
| `PreCompact` | Before context compaction | sync, advisory |
| `PostCompact` | After context compaction | sync, advisory |
| `Notification` | Status / progress events | async, fire-and-forget |
| `FileChanged` | Watched file edits | async |
| `CwdChanged` | `cd` inside the session | sync, advisory |

## settings.json schema

```json
{
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Edit|Write",
                "hooks": [
                    {
                        "command": "biome check --staged",
                        "timeout": 30
                    }
                ]
            }
        ],
        "PostToolUse": [
            {
                "matcher": "Edit|Write",
                "hooks": [
                    {
                        "command": "path=$(jq -r '.tool_input.path // .tool_input.file_path // empty'); [ -z \"$path\" ] || biome format --write \"$path\""
                    }
                ]
            }
        ],
        "Stop": [
            {
                "matcher": "*",
                "hooks": [
                    { "command": "npm test --silent" }
                ]
            }
        ]
    }
}
```

## Matchers

| Matcher | Purpose |
|---|---|
| `Edit\|Write` | Regex against tool name for `PreToolUse` / `PostToolUse` |
| `startup`, `resume`, `clear`, `compact` | Session-start sources |
| `manual`, `auto` | Compaction trigger type |
| `*` or omitted | Match everything for that event |

## Hook output

`PreToolUse` hooks are currently advisory. They can add context and may return `hookSpecificOutput.updatedInput` to adjust tool input, but they do not block tool execution yet. Use approval mode and tool allowlists for hard gates.

`PostToolUse` and other events: stdout from the hook is appended to the model's context as a system reminder. Exit code is logged but not used to gate.

## stdout-as-assistant-context (the killer feature)

Anything a hook prints to stdout is fed back to the model as a system reminder. Use this to:

- Inject the latest CI status before the model decides how to fix.
- Re-fetch the user's recent commits so the model knows the diff is fresh.
- Run a linter and let the output guide the model's next edit.

Example: a `PostToolUse` hook that reports failing tests:

```json
{
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "Edit|Write",
                "hooks": [
                    { "command": "npm test --silent --json | jq '.numFailedTests' || true" }
                ]
            }
        ]
    }
}
```

If the count is non-zero, the model sees `123` in its context and proactively fixes failures.

## Bundled hook recipes

| Hook | Event | Purpose |
|---|---|---|
| `auto-format` | `PostToolUse` Edit/Write | Run Biome / prettier on changed files |
| `auto-test` | `Stop` | Run the test suite, report failures |
| `commit-gate` | `PreToolUse` Bash matching `git commit` | Report non-conventional commit messages |
| `secret-scan` | `PreToolUse` Write | Report writes that contain secrets (`gitleaks` / `trufflehog`) |

These recipes are not enabled by default. View them with `/hooks recipes` and install or copy the ones you want.

## Slash commands

```text
/hooks list
/hooks test PreToolUse --tool Edit --path src/foo.ts
```

`/hooks` opens the same view inside the TUI.

## Importing Claude Code hooks

```bash
cp ~/.claude/settings.json ~/.mewrite/agent/settings.json
# adjust permission mode if needed; the rest works as-is
```

## Anti-patterns

- **Long blocking PreToolUse hooks** — 30s timeout is hard. Move heavy work to PostToolUse.
- **Mutating files in PostToolUse without re-reading** — the model's context still shows the pre-mutation file. Pair with a `read` directive in the next turn.
- **Hooks where skills would fit** — hooks enforce invariants; skills express knowledge. Pick correctly.
