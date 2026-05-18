---
title: Memory (cavemem)
description: Native cavemem integration. Episodic, semantic, and procedural memory.
---

# Memory (cavemem)

Caveman Code delegates persistent memory to **cavemem** — the user's existing MIT-licensed memory system at [github.com/JuliusBrussee/cavemem](https://github.com/JuliusBrussee/cavemem). Caveman Code's value-add is **policy**: when to write, what to inject, and the episodic→semantic consolidation pass.

<CopyForLlms />

## What cavemem provides

- SQLite (FTS5) storage with hybrid search: BM25 + local vectors (`Xenova/all-MiniLM-L6-v2`, alpha=0.5).
- ~75% prose-token reduction via caveman-grammar compression. Code, paths, and URLs preserved byte-for-byte.
- Stdio MCP server with four tools: `search`, `timeline`, `get_observations`, `list_sessions`.
- Hook CLI: `cavemem hook run <event>` reads stdin and writes observations.
- Privacy: `<private>...</private>` blocks are redacted before storage.

## How caveman-code uses it

```
caveman session
  ├── on session_start  → cavemem hook run session-start  (write)
  ├── on user_prompt    → cavemem hook run user-prompt-submit  (write)
  ├── on post_tool_use  → cavemem hook run post-tool-use  (write, async)
  ├── on stop           → cavemem hook run stop  (write)
  └── reads via cavemem MCP (search, timeline, observations, sessions)
```

On session start, caveman-code runs `cavemem search "<task summary>"` and injects compact snippets into context. The injection is capped at 2k tokens by default (`memory.maxInjectTokens`).

## Setup

If `cavemem` is on your `$PATH`, cave wires it during `caveman init`. If not:

```bash
npm install -g cavemem
caveman init    # detects cavemem, writes hook stubs to ~/.cave/settings.json
```

To disable: `/memory off` (session-only) or remove the hooks from `settings.json` (permanent).

## Slash commands

| Command | What it does |
|---|---|
| `/memory search <query>` | Hybrid search across all sessions |
| `/memory save <text>` | Write an explicit observation (kind: explicit) |
| `/memory show <id>` | Expand a snippet to full body |
| `/memory forget <id>` | Soft-delete an observation |
| `/memory export [--format md\|json]` | Dump memory |
| `/memory consolidate` | **Caveman Code-specific**: cluster recent observations, ask Haiku for semantic facts, write back as `kind:semantic` |
| `/memory off` `/memory on` | Pause/resume injection for the current session |
| `/memory config` | Edit memory settings |
| `/memory sync --from claude` | One-shot import of `~/.claude/projects/<slug>/memory/MEMORY.md` |

## Caveman Code's value-add

### Episodic→semantic consolidation

Run nightly (via cron) or on-demand with `/memory consolidate`. Caveman Code clusters observations by topic, asks Haiku to extract semantic facts, writes them back as `kind: semantic` with provenance ids pointing at the source episodic observations. This closes a loop most agents skip — what makes Letta and Zep feel "smart" — but local, deterministic, and cheap.

```bash
# nightly cron
0 2 * * * cave memory consolidate --since 24h --model haiku
```

### Auto-trigger learning

When a tool call fails twice and then succeeds, caveman-code writes a "lesson" observation:

```
kind: lesson
context: "applying eslint-config-cave to a TypeScript monorepo"
fail: "biome.json with deprecated lint key"
fix: "rename to linter, drop the legacy formatter block"
provenance: [obs_id_1, obs_id_2, obs_id_3]
```

Mirrors Claude Code's Auto-Memory.

### MEMORY.md bridge

On session start, caveman-code reads `~/.claude/projects/<slug>/memory/MEMORY.md` (first 200 lines) so it behaves consistently when invoked in a project where Claude Code is also active.

```bash
caveman memory sync --from claude
```

Imports the per-fact `.md` files as cavemem observations.

## Privacy

- Anything between `<private>` and `</private>` is dropped before write. Use it for credentials, names, etc.
- Caveman Code never sends memory content to a model unless explicitly injected (search results, `get_observations`).
- Storage is local: `~/.cavemem/`. No telemetry, no cloud.

## Falling back to files

If you don't want cavemem, set `memory.provider: files` in `~/.cave/settings.json`. Caveman Code then uses plain `.cave/memory/*.md` files and `CLAUDE.md` for project context.

```json
{
    "memory": {
        "provider": "files",
        "files": { "dir": ".cave/memory" }
    }
}
```

## Troubleshooting

- **`cavemem: command not found`** — install it (`npm i -g cavemem`) or set `memory.provider: files`.
- **Memory injection too aggressive** — lower `memory.maxInjectTokens`.
- **Want to wipe** — `rm -rf ~/.cavemem/`.
