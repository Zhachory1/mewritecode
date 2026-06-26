---
title: Migrating from Codex
description: Codex configs map directly to Me Write Code. AGENTS.md, .mcp.json, plugins all work.
---

# Migrating from Codex

Codex (OpenAI's terminal agent) and Me Write Code agree on most file formats. AGENTS.md, .mcp.json, and Codex-style plugins drop in.

<CopyForLlms />

## TL;DR

```bash
# 1. Install
npm install -g @zhachory1/mewrite-code

# 2. Project context
#    Codex's AGENTS.md → mewrite-code reads it directly. No copy needed.
#    Layered with CLAUDE.md if present.

# 3. MCP
#    .mcp.json — Me Write Code reads the Codex format directly.

# 4. Plugins
cp -r .codex-plugin .cave-plugin    # both use root-level plugin manifest

# 5. Auth
#    If you used ChatGPT OAuth in Codex, use the same in Me Write Code:
mewrite
> /login chatgpt
```

## What maps

| Codex | Me Write Code | Notes |
|---|---|---|
| `AGENTS.md` | `AGENTS.md` (read) | Layered with `CLAUDE.md` when present |
| `.mcp.json` | `.mcp.json` | Identical schema |
| `.codex-plugin/plugin.json` | `.cave-plugin/plugin.json` | Compatible at root level |
| `--cd` | `--cwd` | Same semantics |
| `--ephemeral` | `--ephemeral` | Same flag |
| `codex exec` | `mewrite exec` | Same JSON event stream |

## Permissions / sandbox

Me Write Code supports plan mode, approval mode, checkpoints, and beta native sandboxing. If you relied on Codex's `read_only` / `workspace_write` / `danger_full_access` profiles, map them to Me Write Code's plan/approval/sandbox settings and verify with `mewrite doctor`.

## ChatGPT OAuth

Both Codex and Me Write Code authenticate against ChatGPT Plus/Pro. The Me Write Code login command is `/login chatgpt`. Tokens land in `~/.mewrite/agent/auth.json` with user-only file permissions.

If you also have ChatGPT-keyed Codex sessions running, the two share nothing — they each have their own credential cache.

## Differences

### Provider flexibility

Codex is OpenAI-only. Me Write Code supports 20+ providers and 5 built-in OAuth flows. After migrating you can:

```bash
mewrite --model claude-sonnet-4
mewrite --model anthropic/claude-opus-4-7
mewrite --model groq/llama-3.3-70b-versatile
```

### Caveman Mode compression

Me Write Code compresses tool output by default. Exact savings depend on task and provider; use `/cave off` in the TUI if you suspect compression is interfering.

### Daemon / app-server

Codex has a TypeScript app-server protocol. Me Write Code's [daemon](/reference/daemon) (`mewrite serve`) plays the same role with HTTP + WS + SQLite, plus a generated TS SDK at `@zhachory1/mewrite-sdk`.

## CI / `mewrite exec`

```bash
mewrite exec "lint and fix typescript errors" \
    --json \
    --output-schema schema.json \
    --skip-git-repo-check
```

Same pattern as `codex exec`. Stable JSON event stream on stdout. Exit codes documented.

## Confirming

```bash
mewrite doctor
mewrite mcp doctor
mewrite plugin list
```

If your Codex setup includes anything Me Write Code's docs don't cover, [open a migration issue](https://github.com/Zhachory1/mewritecode/issues/new?labels=migration).
