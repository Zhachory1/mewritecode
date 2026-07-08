---
title: Migrating from Aider
description: Aider's repo map and edit formats — both first-class in Me Write Code.
---

# Migrating from Aider

Aider pioneered the **repo map** (PageRank over a tree-sitter symbol graph) and **edit-format-per-model** (whole / diff / udiff / editor formats). Me Write Code ships both, with the same defaults and ablation tables.

<CopyForLlms />

## TL;DR

```bash
# 1. Install
npm install -g @zhachory1/mewrite-code

# 2. Use your existing API keys
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...

# 3. Tell Me Write Code what files you'd manually /add in Aider
mewrite @src/main.py @src/utils.py "Help me with this"

# 4. Use it
mewrite
```

## What maps

| Aider | Me Write Code | Notes |
|---|---|---|
| `/add <file>` | `@file` in TUI | Adds to chat context |
| `/drop <file>` | `/drop` | Removes from chat context |
| `/run <cmd>` | `!cmd` (in TUI) | Or use Bash tool directly |
| `/diff` | `/diff` | Show pending diff |
| `/architect` | `/architect` | Architect/editor split |
| `--map-tokens N` | `/repomap set mapTokens=N` | Same default (1024) |
| `--edit-format` | `--edit-format` | `whole`/`diff`/`udiff`/`editor-diff`/`editor-whole` |
| `.aider.conf.yml` | `~/.mewrite/agent/settings.json` | Different format, same options |
| Conventions file | `AGENTS.md` / `CLAUDE.md` | Read on session start |

## Repo map

Aider's repo map is best-in-class. Me Write Code matches it:

- Tree-sitter parsers for TS/JS/Python/Go/Rust/Java/C++/Ruby/PHP.
- Symbol graph: files = nodes, references = edges.
- PageRank with chat-state personalization (added files + recently mentioned files = personalization vector).
- Send signatures only; bodies on demand.

```bash
/repomap set mapTokens=2048    # bigger map
/repomap                  # show the current ranked list
```

## Edit formats

Auto-selected per model based on `proof-bench` ablation results. Override with `--edit-format`:

| Format | Description | Best for |
|---|---|---|
| `whole` | Replace entire file | small files, clean state |
| `diff` | Search/replace blocks | most tasks |
| `diff-fenced` | Fenced search/replace | models that strip fences |
| `udiff` | Unified diff | weak models, stable across revisions |
| `editor-diff` | Editor model emits diff after architect | architect/editor split |
| `editor-whole` | Editor model emits whole files | architect/editor split |

Me Write Code's defaults are pinned to Aider's published ablation winners and updated when new models ship. See [Models](/getting-started/models).

## Architect / editor split

Same UX as Aider:

```bash
/architect set architectModel=claude-opus-4-7 editorModel=claude-haiku-4
```

Architect plans, editor executes. Drops cost ~3-5× on long sessions. See [Plan Mode](/reference/plan-mode#architect-mode-split-planning--edit).

## Differences

### Caveman Mode compression

Aider compresses by selecting smaller context (repo map). Me Write Code additionally compresses **tool output** post-hoc (~85% reduction on bash, grep, file reads). The two are complementary; both are on by default.

### Watch mode

Aider's `// ai!` and `// ai?` magic comments — Me Write Code uses `// mewrite!` and `// mewrite?`:

```bash
mewrite --watch
```

Trailing `!` triggers code edits with cwd + comment + surrounding lines as context.

### Session model

Aider sessions are tied to a chat history file. Me Write Code sessions are JSONL files under `~/.mewrite/agent/sessions/`. Branchable via `/tree` and `/fork`.

## Conventions file

Aider reads `<repo>/.aider/conventions.md`. Me Write Code reads `AGENTS.md` and `CLAUDE.md` as project context. Move your conventions file to one of those names and you're done.

## Cost tracking

Aider was first to surface per-message cost inline. Me Write Code does the same:

```
[$0.0042 (cached: $0.0001)] Sonnet 4 · 12,431 in / 412 out
```

`/tokens` opens a live breakdown. `/cost` daily and weekly totals include completed assistant messages from active, unclosed sessions; legacy totals are stored in `~/.cave/cost-totals.json` and new per-message records in `~/.cave/cost-ledger.jsonl`.
