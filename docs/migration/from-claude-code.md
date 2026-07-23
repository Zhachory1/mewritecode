---
title: Migrating from Claude Code
description: Zero-migration. Paste your existing config and Me Write Code Just Works.
---

# Migrating from Claude Code

Me Write Code can reuse Claude Code authoring formats while storing its own config under `~/.mewrite/agent/` and project config under `.mewrite/`.

<CopyForLlms />

## TL;DR

```bash
# 1. Install
npm install -g @zhachory1/mewrite-code

# 2. Copy config
mkdir -p ~/.mewrite/agent
cp -r ~/.claude/commands ~/.mewrite/agent/
cp -r ~/.claude/skills ~/.mewrite/agent/
cp -r ~/.claude/agents ~/.mewrite/agent/
cp ~/.claude/settings.json ~/.mewrite/agent/settings.json    # hooks + statusLine

# 3. Project-scope
cp -r .claude .mewrite   # optional project-scope import

# 4. Keep CLAUDE.md or add AGENTS.md; Me Write Code reads both.

# 5. MCP — already standard
#    .mcp.json works as-is.

# 6. Run
mewrite
```

## What maps directly

| Claude Code | Me Write Code | Notes |
|---|---|---|
| `~/.claude/settings.json` | `~/.mewrite/agent/settings.json` | Hooks + statusLine compatible schema |
| `~/.claude/commands/*.md` | `~/.mewrite/agent/commands/*.md` | Frontmatter is a superset |
| `~/.claude/skills/<name>/SKILL.md` | `~/.mewrite/agent/skills/<name>/SKILL.md` | Identical |
| `~/.claude/agents/<name>.md` | `~/.mewrite/agent/agents/<name>.md` | Frontmatter is a superset |
| `.mcp.json` | `.mcp.json` | Same path; no change |
| `CLAUDE.md` | `CLAUDE.md` or `AGENTS.md` | Me Write Code reads both, layered |
| Auto-Memory | cavemem | Different backend; same UX |

## Differences worth knowing

### Memory

Claude Code uses Auto-Memory with `~/.claude/projects/<slug>/memory/MEMORY.md`. Me Write Code uses [cavemem](/reference/memory) by default and falls back to FilesProvider when Cavemem is unavailable. To bridge:

```bash
mewrite memory sync --from claude
```

This imports `MEMORY.md` and per-fact files as cavemem observations. Going forward, if you keep both Claude Code and Me Write Code running in the same project, mewrite-code reads the first 200 lines of `MEMORY.md` on every session start.

### Models

Claude Code is Anthropic-only. Me Write Code is provider-agnostic. After migrating, you can:

```bash
mewrite --model openai/gpt-5-codex
mewrite --model claude-sonnet-4   # default behavior matches Claude Code
```

### Cost

By default Caveman Mode compression is **on**, which Claude Code doesn't have. Expect tool-output token consumption to drop ~85%. If something looks off, bisect with:

```bash
/cave off
```

### Permissions and hooks

Me Write Code supports plan mode, approval mode, checkpoints, and beta native sandboxing. `PreToolUse` hooks can deny, ask, or allow tool calls via Claude Code-compatible hook output.

## Confirming the migration worked

```bash
mewrite doctor                    # general health
# inside the TUI:
/hooks list                       # all hooks loaded
mewrite skills list               # all skills loaded
mewrite agents list               # all subagents loaded
mewrite mcp doctor                # MCP servers reachable
```

If any of these report mismatches, [open an issue](https://github.com/Zhachory1/mewritecode/issues/new?labels=migration) — we treat Claude Code parity as a CI gate.

## Why not just use Claude Code?

- **Token efficiency.** Caveman Mode, tool-output budgets, read deduplication, and prompt-cache-friendly sessions reduce context waste.
- **Provider flexibility.** Use ChatGPT Plus, Copilot, Gemini, or any OpenAI-compatible endpoint.
- **Session branching.** `/tree`, `/fork` — no major competitor has this.
- **MIT.** No vendor lock-in; self-host the daemon.

If none of those matter to you, stay on Claude Code — it's a fine product.
