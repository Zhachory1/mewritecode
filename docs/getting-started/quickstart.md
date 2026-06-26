---
title: Quickstart
description: Install Me Write Code and run your first prompt in under 30 seconds.
---

# Quickstart

Goal: Me Write Code installed, authenticated, first prompt answered. Target time: 30 seconds.

<CopyForLlms />

## 1. Install

```bash
npm install -g @zhachory1/mewrite-code
```

Requires Node.js 20+. Other options (Homebrew, Docker, manual binary) are documented in [Install](/getting-started/installation).

Verify:

```bash
mewrite --version
```

## 2. Authenticate

Pick **one** of these. Me Write Code detects which keys you already have in your environment.

::: code-group

```bash [Anthropic API key]
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash [OpenAI API key]
export OPENAI_API_KEY=sk-...
```

```bash [Claude Pro / ChatGPT Plus / Copilot / Gemini]
mewrite
# inside the TUI:
/login
```

:::

The OAuth flow opens a browser and stores credentials in `~/.mewrite/agent/auth.json` with user-only file permissions.

See the full [Auth & Providers](/getting-started/auth) page for the 20+ supported backends.

## 3. First prompt

```bash
mewrite "explain this codebase"
```

Or open the interactive TUI:

```bash
mewrite
```

Type a prompt and the agent responds. Type `/help` for the full slash-command list.

## What just happened

1. npm installed the `@zhachory1/mewrite-code` package globally, registering `mewrite`, `mewritecode`, and `mewrite-code` commands.
2. On first launch, the wizard ran and persisted your choices to `~/.mewrite/agent/settings.json`.
3. **Caveman Mode** compression is on by default. Tool output (bash, grep, file reads) is summarized before re-entering context.

## Common next steps

| Task | Command / link |
|---|---|
| Continue your last session | `mewrite -c` |
| Browse and resume past sessions | `mewrite -r` |
| Pipe stdin to the agent | `cat README.md \| mewrite -p "review"` |
| Switch model mid-session | `/model claude-sonnet-4` |
| Fork session to try a different path | `/fork` |
| Run in plan-only mode | `/plan` (slash command in TUI) |
| Migrate from Claude Code | [Migration guide](/migration/from-claude-code) |

## Troubleshooting

- `mewrite: command not found` after install — restart your shell, or check that the npm global bin dir is on your PATH (`npm config get prefix`).
- Wizard didn't appear — delete `~/.mewrite/agent/settings.json` and run `mewrite` again.
- Auth fails on Linux — install `libsecret` (`apt install libsecret-1-0` on Debian/Ubuntu) or use API keys via env.

More: [Troubleshooting](/troubleshooting).
