---
title: Migrating from Codex
description: Codex configs map directly to Caveman Code. AGENTS.md, .mcp.json, plugins all work.
---

# Migrating from Codex

Codex (OpenAI's terminal agent) and Caveman Code agree on most file formats. AGENTS.md, .mcp.json, and Codex-style plugins drop in.

<CopyForLlms />

## TL;DR

```bash
# 1. Install
npm install -g caveman-code

# 2. Project context
#    Codex's AGENTS.md → caveman-code reads it directly. No copy needed.
#    Layered with CAVE.md and CLAUDE.md if any are present.

# 3. MCP
#    .mcp.json — Caveman Code reads the Codex format directly.

# 4. Plugins
cp -r .codex-plugin .cave-plugin    # both use root-level plugin manifest

# 5. Auth
#    If you used ChatGPT OAuth in Codex, use the same in Caveman Code:
caveman
> /login chatgpt
```

## What maps

| Codex | Caveman Code | Notes |
|---|---|---|
| `AGENTS.md` | `AGENTS.md` (read) | Layered with CAVE.md / CLAUDE.md |
| `.mcp.json` | `.mcp.json` | Identical schema |
| `.codex-plugin/plugin.json` | `.cave-plugin/plugin.json` | Compatible at root level |
| `--cd` | `--cwd` | Same semantics |
| `--ephemeral` | `--ephemeral` | Same flag |
| `codex exec` | `caveman exec` | Same JSON event stream |

## Permissions / sandbox

Caveman Code runs autopilot — there is no `--sandbox` flag, no permission prompts, and no Seatbelt/Landlock policy. If you relied on Codex's `read_only` / `workspace_write` / `danger_full_access` profiles, drop them; caveman-code will execute every tool request directly. The OS still enforces filesystem permissions and you can constrain a session by tightening the agent's `tools` list (e.g. omitting `bash`, `edit`, `write`).

## ChatGPT OAuth

Both Codex and Caveman Code authenticate against ChatGPT Plus/Pro. The Caveman Code login command is `/login chatgpt`. Tokens land in your OS keychain.

If you also have ChatGPT-keyed Codex sessions running, the two share nothing — they each have their own token cache.

## Differences

### Provider flexibility

Codex is OpenAI-only. Caveman Code supports 20+ providers and 6 OAuth flows. After migrating you can:

```bash
caveman --model claude-sonnet-4
caveman --model anthropic/claude-opus-4-7
caveman --model groq/llama-3.3-70b-versatile
```

### Caveman Mode compression

Caveman Code compresses tool output by default (~85% reduction). Codex doesn't. Expect markedly lower token bills. Disable with `--no-caveman-mode` if you suspect it's interfering.

### Daemon / app-server

Codex has a TypeScript app-server protocol. Caveman Code's [daemon](/reference/daemon) (`caveman serve`) plays the same role with HTTP + WS + SQLite, plus a generated TS SDK at `@caveman-code/sdk`.

## CI / `caveman exec`

```bash
caveman exec "lint and fix typescript errors" \
    --json \
    --output-schema schema.json \
    --skip-git-repo-check
```

Same pattern as `codex exec`. Stable JSON event stream on stdout. Exit codes documented.

## Confirming

```bash
caveman doctor
caveman mcp doctor
caveman plugin list
```

If your Codex setup includes anything Caveman Code's docs don't cover, [open a migration issue](https://github.com/JuliusBrussee/caveman-cli/issues/new?labels=migration).
