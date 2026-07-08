---
title: Tools
description: Me Write Code's built-in tools, Caveman Mode compression, and cost transparency.
---

# Tools

Me Write Code ships seven built-in tools, plus dynamic tools loaded from MCP servers and skills. All tool output is run through **Caveman Mode** compression before re-entering the model's context.

<CopyForLlms />

## Built-in tools

| Tool | Purpose | Default mode access |
|---|---|---|
| `Read` | Read a file or range of lines | always |
| `Find` / `Ls` | Locate files and list directories | always |
| `Grep` | Search file contents (ripgrep-backed) | always |
| `Bash` | Run shell commands | gated by sandbox/approval settings |
| `Edit` | Find/replace edit on a file | gated by approval settings |
| `Write` | Write a file | gated by approval settings |
| `Task` / `Agent` | Dispatch a [subagent](/reference/subagents) | always |

Plan mode restricts to read-only tools (`Read`, `Find`, `Ls`, `Grep`, and safe `Bash`). Enable with `/plan` in the TUI. See [Plan Mode](/reference/plan-mode).

## Caveman Mode compression

Four compression layers reduce repeated and verbose context. Exact savings depend on provider, model, and task; the public benchmark is under revalidation.

| Layer | What happens | Impact |
|---|---|---|
| **Caveman Mode** | Model responds in terse technical fragments. Levels: `lite`, `full`, `ultra`. | Prompt + response compression |
| **Tool Budgets** | Per-tool line limits (bash: 80, read: 300, grep: 120) + ANSI strip + blank collapse + semantic JSON/XML extraction | -67% to -94% on tool output |
| **Read Dedup** | Files fingerprinted per session — re-reads return a stub, not the content | -99% on repeated reads |
| **RTK** | Optional Rust binary rewrites bash output before it enters context | ~60% additional reduction |

### Per-tool budgets

```json
{
    "tools": {
        "budgets": {
            "bash": { "maxLines": 80, "stripAnsi": true },
            "read": { "maxLines": 300, "dedupeAcrossSession": true },
            "grep": { "maxLines": 120 }
        }
    }
}
```

Override per session with `--max-tool-lines 200`. Override globally in `~/.mewrite/agent/settings.json`.

## Cost transparency

Per-message inline:

```
[$0.0042 (cached: $0.0001)] Sonnet 4 · 12,431 in / 412 out
```

Session summary on `/exit`:

```
session: 32 turns · 2h 14m
total: $1.84 — cache + compression savings reported separately
breakdown:
  system    +1,200 tokens
  repomap     +840
  history  +12,150
  files     +8,421
  tools    +18,902 (compressed)
```

`/tokens` opens a live breakdown panel.

Daily/weekly totals persist locally and include completed assistant messages from active, unclosed sessions. Legacy closed-session totals live in `~/.cave/cost-totals.json`; new per-message records live in `~/.cave/cost-ledger.jsonl`. After upgrade, pre-upgrade turns in still-open sessions are not backfilled and may remain missing from `/cost`; new completed assistant messages are counted going forward.

## ToolSearch (deferred MCP schemas)

By default, MCP tools are listed by name only. The model fetches the schema via `ToolSearch` only when needed. This is the same trick Anthropic uses to cut 85% of context bloat.

## Registry

Provider, model, and tool defaults ship with Me Write Code and can be refreshed without upgrading the CLI:

```bash
mewrite models update
```

Override locally in `~/.mewrite/agent/registry.json`.
