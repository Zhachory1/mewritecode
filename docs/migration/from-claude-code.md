---
title: Migrating from Claude Code
description: Zero-migration. Paste your existing config and Caveman Code Just Works.
---

# Migrating from Claude Code

The promise: **paste your existing Claude Code config into `~/.cave/` and Caveman Code behaves the same — only cheaper**. Caveman Code's authoring formats are a superset of Claude Code's.

<CopyForLlms />

## TL;DR

```bash
# 1. Install
npm install -g caveman-code

# 2. Copy config
cp -r ~/.claude/commands ~/.cave/
cp -r ~/.claude/skills ~/.cave/
cp -r ~/.claude/agents ~/.cave/
cp ~/.claude/settings.json ~/.cave/settings.json    # hooks + statusLine

# 3. Project-scope
ln -s .claude .cave   # or: cp -r .claude .cave (if you want them independent)

# 4. CLAUDE.md → CAVE.md (or keep CLAUDE.md; caveman-code reads both)
ln -s CLAUDE.md CAVE.md

# 5. MCP — already standard
#    .mcp.json works as-is.

# 6. Run
caveman
```

## What maps directly

| Claude Code | Caveman Code | Notes |
|---|---|---|
| `~/.claude/settings.json` | `~/.cave/settings.json` | Hooks + statusLine identical schema (caveman-code runs hooks as observers) |
| `~/.claude/commands/*.md` | `~/.cave/commands/*.md` | Frontmatter is a superset |
| `~/.claude/skills/<name>/SKILL.md` | `~/.cave/skills/<name>/SKILL.md` | Identical |
| `~/.claude/agents/<name>.md` | `~/.cave/agents/<name>.md` | Frontmatter is a superset |
| `.mcp.json` | `.mcp.json` | Same path; no change |
| `CLAUDE.md` | `CLAUDE.md` (read) or `CAVE.md` (preferred) | Caveman Code reads both, layered |
| Auto-Memory | cavemem | Different backend; same UX |

## Differences worth knowing

### Memory

Claude Code uses Auto-Memory with `~/.claude/projects/<slug>/memory/MEMORY.md`. Caveman Code uses [cavemem](/reference/memory). To bridge:

```bash
caveman memory sync --from claude
```

This imports `MEMORY.md` and per-fact files as cavemem observations. Going forward, if you keep both Claude Code and Caveman Code running in the same project, caveman-code reads the first 200 lines of `MEMORY.md` on every session start.

### Models

Claude Code is Anthropic-only. Caveman Code is provider-agnostic. After migrating, you can:

```bash
caveman --model openai/gpt-5-codex
caveman --model claude-sonnet-4   # default behavior matches Claude Code
```

### Cost

By default Caveman Mode compression is **on**, which Claude Code doesn't have. Expect tool-output token consumption to drop ~85%. If something looks off, bisect with:

```bash
caveman --no-caveman-mode
```

### Permissions

Caveman Code runs in autopilot — there is no permission prompt, no `--permission-mode` flag, and no Shift+Tab mode cycle. Tools always execute. If you need a tool firewall, write a `PreToolUse` hook (it can rewrite tool input but cannot block).

### Hooks

`PreToolUse` and `PostToolUse` fire as **observers**. They can patch tool input via `hookSpecificOutput.updatedInput` and add stdout to context, but they cannot deny or block a tool call. Claude Code's "exit code 2 = deny" semantics do not apply here.

## Confirming the migration worked

```bash
caveman doctor                    # general health
caveman hooks list                # all hooks loaded
caveman skills list               # all skills loaded
caveman agents list               # all subagents loaded
caveman mcp doctor                # MCP servers reachable
```

If any of these report mismatches, [open an issue](https://github.com/JuliusBrussee/caveman-cli/issues/new?labels=migration) — we treat Claude Code parity as a CI gate.

## Why not just use Claude Code?

- **Cost.** Caveman Mode compression saves $1.70-$6.92 per typical session (proven in `npm run bench:offline`).
- **Provider flexibility.** Use ChatGPT Plus, Copilot, Gemini, or any OpenAI-compatible endpoint.
- **Session branching.** `/tree`, `/fork` — no major competitor has this.
- **MIT.** No vendor lock-in; self-host the daemon.

If none of those matter to you, stay on Claude Code — it's a fine product.
