# Default Hook Recipes

Four ready-to-use shell hooks shipped with mewrite-code. They illustrate the mewrite-code
hook authoring pattern and are listed with `/hooks recipes` in the TUI.

| Recipe | Event | Matcher | Purpose |
|---|---|---|---|
| `auto-format-on-edit.sh` | `PostToolUse` | `Edit\|Write` | Run biome / prettier / ruff / gofmt / rustfmt on every file the agent touches. Advisory. |
| `auto-test-on-stop.sh` | `Stop` | — | Run the project's test command at end-of-turn and feed output back as assistant context. |
| `conventional-commit-gate.sh` | `PreToolUse` | `Bash` | Report `git commit -m "..."` messages that are not Conventional Commits 1.0.0. |
| `secret-scan.sh` | `PreToolUse` | `Write\|Edit` | Report writes that contain AWS / GitHub / OpenAI / Anthropic / Slack / PEM private-key patterns. |

## Wiring

Add to `~/.mewrite/agent/settings.json` or `.mewrite/settings.json`. `/hooks install-recipe` currently writes recipe scripts under `.cave/hooks/`; the example below uses the canonical `.mewrite/hooks/` path for manual setup:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.mewrite/hooks/auto-format-on-edit.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.mewrite/hooks/auto-test-on-stop.sh", "timeout": 300 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.mewrite/hooks/conventional-commit-gate.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "$CAVE_PROJECT_DIR/.mewrite/hooks/secret-scan.sh", "timeout": 5 }
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
- `PreToolUse` is currently advisory/input-mutating; use approval mode or tool allowlists for hard gates. Stderr goes back to the agent.
- Anything else is non-blocking advisory; stderr surfaces in the transcript.
