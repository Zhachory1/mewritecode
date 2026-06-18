# Default Hook Recipes

Four ready-to-use shell hooks shipped with mewrite-code. They illustrate the mewrite-code
hook authoring pattern and are referenced from `mewrite hooks list --recipes`.

| Recipe | Event | Matcher | Purpose |
|---|---|---|---|
| `auto-format-on-edit.sh` | `PostToolUse` | `Edit\|Write` | Run biome / prettier / ruff / gofmt / rustfmt on every file the agent touches. Advisory. |
| `auto-test-on-stop.sh` | `Stop` | — | Run the project's test command at end-of-turn and feed output back as assistant context. |
| `conventional-commit-gate.sh` | `PreToolUse` | `Bash` | Block `git commit -m "..."` when the message isn't Conventional Commits 1.0.0. |
| `secret-scan.sh` | `PreToolUse` | `Write\|Edit` | Block writes that contain AWS / GitHub / OpenAI / Anthropic / Slack / PEM private-key patterns. |

## Wiring

Add to `~/.cave/settings.json` or `.cave/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.cave/hooks/auto-format-on-edit.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.cave/hooks/auto-test-on-stop.sh", "timeout": 300 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.cave/hooks/conventional-commit-gate.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.cave/hooks/secret-scan.sh", "timeout": 5 }
        ]
      }
    ]
  }
}
```

`$CAVE_PROJECT_DIR` resolves to the project root mewrite-code is running in.
The Claude-Code-compatible alias `$CLAUDE_PROJECT_DIR` works identically.

## Authoring conventions

- Read JSON from stdin (`cat`), parse with python3 / jq / your runtime of choice.
- Exit 0 on success. Stdout becomes assistant context for `SessionStart`,
  `UserPromptSubmit`, `Stop`, `PreCompact`, `PostCompact` (the
  stdout-as-context pattern). For other events, use
  `hookSpecificOutput.additionalContext` in a JSON envelope.
- Exit 2 to **block** (PreToolUse only). Stderr goes back to the agent.
- Anything else is non-blocking advisory; stderr surfaces in the transcript.
