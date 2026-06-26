---
title: MCP
description: Model Context Protocol — clients, transports, and Me Write Code as an MCP server.
---

# MCP

Me Write Code is a first-class MCP client and can also serve a minimal MCP server. Current supported client transports are **stdio** (subprocess + JSON-RPC) and **in-process** (zero-spawn for bundled tools). Streamable HTTP is tracked separately.

<CopyForLlms />

## Quick start

```bash
mewrite mcp add cavemem --command cavemem --arg mcp
mewrite mcp add gh --command github-mcp
mewrite mcp list
mewrite mcp doctor
```

`mewrite mcp add` writes to project `.mcp.json` by default. Use `--user` to write to `~/.mewrite/mcp.json`.

## Configuration

`.mcp.json` (project) or `~/.mewrite/mcp.json` (user):

```json
{
    "mcpServers": {
        "cavemem": {
            "transport": "stdio",
            "command": "cavemem",
            "args": ["mcp"],
            "env": {}
        },
        "github": {
            "transport": "stdio",
            "command": "github-mcp",
            "env": { "GITHUB_TOKEN": "..." }
        },
        "filesystem": {
            "transport": "inproc",
            "module": "@zhachory1/mewrite-mcp-filesystem"
        }
    }
}
```

User config is merged on top of project config. The `transport` determines how Me Write Code connects.

## Transports

| Transport | When to use |
|---|---|
| `stdio` | Local subprocess. Standard for community MCP servers. |
| `http` | Planned; not implemented in the current MCP client. |
| `inproc` | Bundled with Me Write Code; zero spawn, lowest latency. |

## OAuth 2.1

OAuth support is still provider-specific. For now, prefer MCP servers that accept tokens via environment variables or command-line configuration.

## Tool namespacing

MCP tools are namespaced as `mcp__<server>__<tool>` to avoid collisions. The model sees them under their registered names; the system prompt explains the namespace convention.

## Schema deferral (ToolSearch)

By default Me Write Code only lists MCP tool **names** in the always-on context. Schemas are fetched on demand via `ToolSearch`. This matches Anthropic's pattern and cuts ~85% of context bloat.

## Lifecycle

Idle stdio MCP transports are closed by the client when swept. They are restarted on demand.

## Me Write Code as MCP server

```bash
mewrite mcp-server
```

Current server mode is stdio-based and exposes a minimal health tool. Full coding-tool server mode is planned separately.

## Importing Claude Code / Codex MCP config

Me Write Code reads `.mcp.json` at the project root (Claude Code / Codex format). No conversion needed.

```bash
cp .claude.json .mcp.json   # if you had a Claude-only config in the same shape
```

## Troubleshooting

- **`mewrite mcp doctor`** — pings every configured server, reports timeouts and auth failures.
- Check the terminal that launched the stdio server for stderr output.
- **Server crashes loop** — Me Write Code backs off to 1 / 5 / 30 minute retry intervals; you'll see a doctor warning.
