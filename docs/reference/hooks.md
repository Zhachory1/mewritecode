---
title: Hooks
description: 12-event lifecycle hooks. settings.json schema is identical to Claude Code.
---

# Hooks

Hooks are shell commands triggered by lifecycle events. Me Write Code matches **Claude Code's settings.json schema verbatim** — paste your existing `~/.claude/settings.json` into `~/.cave/settings.json` and your hooks Just Work.

<CopyForLlms />

## Events

| Event | When fires | Sync? |
|---|---|---|
| `SessionStart` | Me Write Code session boots | sync, advisory |
| `SessionEnd` | Me Write Code exits | sync, advisory |
| `UserPromptSubmit` | User sends a turn | sync, advisory (stdout → context) |
| `Stop` | Model returns final response | sync, advisory |
| `SubagentStop` | A subagent returns to parent | sync, advisory |
| `PreToolUse` | Before any tool call | **sync, blocking, 30s timeout** |
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
                "matcher": { "tool": "Edit|Write", "paths": ["src/**/*.ts"] },
                "command": ["bash", "-lc", "biome check --staged"],
                "timeout": 30,
                "decision": "deny-on-nonzero"
            }
        ],
        "PostToolUse": [
            {
                "matcher": { "tool": "Edit" },
                "command": ["bash", "-lc", "biome format --write \"$CAVE_HOOK_FILES\""]
            }
        ],
        "Stop": [
            {
                "command": ["bash", "-lc", "npm test --silent"],
                "decision": "advisory"
            }
        ]
    }
}
```

## Matchers

| Matcher key | Purpose |
|---|---|
| `tool` | Regex against tool name. `Edit\|Write` matches both. |
| `paths` | Glob patterns. Hook only fires if a tool argument is a path under a glob. |
| `provider` | Restrict by active provider. |
| `cwd` | Glob against the session's cwd. |
| `arguments` | JSONPath-ish match against tool arguments. |

## Decisions

`PreToolUse` hooks return one of:

| Decision | Effect |
|---|---|
| `allow` | Tool call proceeds. Default if exit 0. |
| `deny` | Tool call denied. Reason fed back to the model. Exit 2 from the hook. |
| `ask` | User is prompted before the tool call. |
| `defer` | Skip this hook this turn (used by recipes). |

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
                "matcher": { "tool": "Edit|Write" },
                "command": ["bash", "-lc", "npm test --silent --json | jq '.numFailedTests' || true"]
            }
        ]
    }
}
```

If the count is non-zero, the model sees `123` in its context and proactively fixes failures.

## Default hooks shipped with Me Write Code

| Hook | Event | Purpose |
|---|---|---|
| `auto-format` | `PostToolUse` Edit/Write | Run Biome / prettier on changed files |
| `auto-test` | `Stop` | Run the test suite, report failures |
| `commit-gate` | `PreToolUse` Bash matching `git commit` | Enforce conventional-commit format |
| `secret-scan` | `PreToolUse` Write | Block writes that contain secrets (`gitleaks` / `trufflehog`) |

Disable any of these in `settings.json` by setting `enabled: false`.

## Slash commands

```bash
mewrite hooks list             # all hooks, scope, status
mewrite hooks test PreToolUse --tool Edit --path src/foo.ts
```

`/hooks` opens the same view inside the TUI.

## Importing Claude Code hooks

```bash
cp ~/.claude/settings.json ~/.cave/settings.json
# adjust permission mode if needed; the rest works as-is
```

## Anti-patterns

- **Long blocking PreToolUse hooks** — 30s timeout is hard. Move heavy work to PostToolUse.
- **Mutating files in PostToolUse without re-reading** — the model's context still shows the pre-mutation file. Pair with a `read` directive in the next turn.
- **Hooks where skills would fit** — hooks enforce invariants; skills express knowledge. Pick correctly.
