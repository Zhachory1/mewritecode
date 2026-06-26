---
title: Memory (cavemem)
description: Native cavemem integration. Episodic, semantic, and procedural memory.
---

# Memory (cavemem)

Me Write Code delegates persistent memory to **cavemem** — the user's existing MIT-licensed memory system at [github.com/JuliusBrussee/cavemem](https://github.com/JuliusBrussee/cavemem). Me Write Code's value-add is **policy**: when to write, what to inject, and the episodic→semantic consolidation pass.

<CopyForLlms />

## What cavemem provides

- SQLite (FTS5) storage with hybrid search: BM25 + local vectors (`Xenova/all-MiniLM-L6-v2`, alpha=0.5).
- Prose-token reduction via compact grammar. Code, paths, and URLs preserved byte-for-byte.
- Stdio MCP server with four tools: `search`, `timeline`, `get_observations`, `list_sessions`.
- Hook CLI: `cavemem hook run <event>` reads stdin and writes observations.
- Privacy: `<private>...</private>` blocks are redacted before storage.

## How mewrite-code uses it

```
mewrite session
  ├── on session_start  → cavemem hook run session-start  (write)
  ├── on user_prompt    → cavemem hook run user-prompt-submit  (write)
  ├── on post_tool_use  → cavemem hook run post-tool-use  (write, async)
  ├── on stop           → cavemem hook run stop  (write)
  └── reads via cavemem MCP (search, timeline, observations, sessions)
```

On session start, mewrite-code runs `cavemem search "<task summary>"` and injects compact snippets into context. The injection is capped at 2k tokens by default (`memory.maxInjectTokens`).

## Setup

If `cavemem` is on your `$PATH`, Me Write Code can use it as the memory backend:

```bash
npm install -g cavemem
mewrite mcp add cavemem --command cavemem --arg mcp
```

Memory recall/tools are enabled when the provider is reachable. To auto-record lifecycle observations through hooks, start sessions with `CAVE_MEMORY_AUTO_RECORD=1` or wire the cavemem hook commands manually in `~/.mewrite/agent/settings.json`.

To disable for a session: `/memory off`.

## Slash commands

| Command | What it does |
|---|---|
| `/memory search <query>` | Hybrid search across all sessions |
| `/memory save <text>` | Write an explicit observation (kind: explicit) |
| `/memory show <id>` | Expand a snippet to full body |
| `/memory forget <id>` | Soft-delete an observation |
| `/memory export [--format md\|json]` | Dump memory |
| `/memory consolidate` | **Me Write Code-specific**: cluster recent observations, ask Haiku for semantic facts, write back as `kind:semantic` |
| `/memory off` `/memory on` | Pause/resume injection for the current session |
| `/memory config` | Edit memory settings |
| `/memory sync --from claude` | One-shot import of `~/.claude/projects/<slug>/memory/MEMORY.md` |

## Me Write Code's value-add

### Episodic→semantic consolidation

Run nightly (via cron) or on-demand with `/memory consolidate`. Me Write Code clusters observations by topic, asks Haiku to extract semantic facts, writes them back as `kind: semantic` with provenance ids pointing at the source episodic observations. This closes a loop most agents skip — what makes Letta and Zep feel "smart" — but local, deterministic, and cheap.

```bash
# nightly cron
0 2 * * * mewrite memory consolidate --since 24h --model haiku
```

### Auto-trigger learning

When a tool call fails twice and then succeeds, mewrite-code writes a "lesson" observation:

```
kind: lesson
context: "applying Biome config to a TypeScript monorepo"
fail: "biome.json with deprecated lint key"
fix: "rename to linter, drop the legacy formatter block"
provenance: [obs_id_1, obs_id_2, obs_id_3]
```

Mirrors Claude Code's Auto-Memory.

### MEMORY.md bridge

On session start, mewrite-code reads `~/.claude/projects/<slug>/memory/MEMORY.md` (first 200 lines) so it behaves consistently when invoked in a project where Claude Code is also active.

```bash
mewrite memory sync --from claude
```

Imports the per-fact `.md` files as cavemem observations.

## Privacy

- Anything between `<private>` and `</private>` is dropped before write. Use it for credentials, names, etc.
- Me Write Code never sends memory content to a model unless explicitly injected (search results, `get_observations`).
- Storage is local: `~/.cavemem/`. No telemetry, no cloud.

## Falling back to files

If you don't want cavemem, set `memory.provider: files` in `~/.mewrite/agent/settings.json`. Me Write Code then uses plain `.mewrite/memory/*.md` files and project context docs.

```json
{
    "memory": {
        "provider": "files",
        "files": { "dir": ".mewrite/memory" }
    }
}
```

## Troubleshooting

- **`cavemem: command not found`** — install it (`npm i -g cavemem`) or set `memory.provider: files`.
- **Memory injection too aggressive** — lower `memory.maxInjectTokens`.
- **Want to wipe** — `rm -rf ~/.cavemem/`.
