---
title: Quickstart
description: Install Caveman Code and run your first prompt in under 30 seconds.
---

# Quickstart

Goal: Caveman Code installed, authenticated, first prompt answered. Target time: 30 seconds.

<CopyForLlms />

## 1. Install

```bash
npm install -g @juliusbrussee/caveman-code
```

Requires Node.js 20+. Other options (Homebrew, Docker, manual binary) are documented in [Install](/getting-started/installation).

Verify:

```bash
caveman --version
```

## 2. Authenticate

Pick **one** of these. Caveman Code detects which keys you already have in your environment.

::: code-group

```bash [Anthropic API key]
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash [OpenAI API key]
export OPENAI_API_KEY=sk-...
```

```bash [Claude Pro / ChatGPT Plus / Copilot / Gemini]
caveman
# inside the TUI:
/login
```

:::

The OAuth flow opens a browser and stores tokens in your OS keychain (macOS Keychain, Linux libsecret, Windows Credential Manager).

See the full [Auth & Providers](/getting-started/auth) page for the 20+ supported backends.

## 3. First prompt

```bash
caveman "explain this codebase"
```

Or open the interactive TUI:

```bash
caveman
```

Type a prompt and the agent responds. Type `/help` for the full slash-command list.

## What just happened

1. npm installed the `@juliusbrussee/caveman-code` package globally, registering two binaries: `caveman` and `caveman-code` (aliases).
2. On first launch, the wizard ran (4 questions: theme, auth, default model, telemetry off-by-default) and persisted your choice to `~/.cave/settings.json`.
3. **Caveman Mode** compression is on by default. Tool output (bash, grep, file reads) is summarized before re-entering context.

## Common next steps

| Task | Command / link |
|---|---|
| Continue your last session | `caveman -c` |
| Browse and resume past sessions | `caveman -r` |
| Pipe stdin to the agent | `cat README.md \| caveman -p "review"` |
| Switch model mid-session | `/model claude-sonnet-4` |
| Fork session to try a different path | `/fork` |
| Run in plan-only mode | `caveman --plan` (or Shift+Tab in TUI) |
| Migrate from Claude Code | [Migration guide](/migration/from-claude-code) |

## Troubleshooting

- `caveman: command not found` after install — restart your shell, or check that the npm global bin dir is on your PATH (`npm config get prefix`).
- Wizard didn't appear — delete `~/.cave/settings.json` and run `caveman` again.
- Auth fails on Linux — install `libsecret` (`apt install libsecret-1-0` on Debian/Ubuntu) or use API keys via env.

More: [Troubleshooting](/troubleshooting).
