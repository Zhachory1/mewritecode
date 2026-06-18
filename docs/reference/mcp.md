---
title: MCP
description: Model Context Protocol — clients, transports, and cave-as-MCP-server.
---

# MCP

Me Write Code is a first-class MCP client and can also serve as an MCP server. Three transports: **stdio** (subprocess + JSON-RPC), **Streamable HTTP** (SSE deprecating mid-2026), and **in-process** (zero-spawn for mewrite-code's own tools).

<CopyForLlms />

## Quick start

```bash
mewrite mcp add cavemem
mewrite mcp add gh --command "github-mcp" --transport stdio
mewrite mcp list
mewrite mcp doctor
```

`mewrite mcp add` reads from a registry and writes to `~/.cave/mcp.json` or `.mcp.json` (project-scope).

## Configuration

`.mcp.json` (project) or `~/.cave/mcp.json` (user):

```json
{
    "servers": {
        "cavemem": {
            "transport": "stdio",
            "command": "cavemem",
            "args": ["mcp"],
            "env": {}
        },
        "github": {
            "transport": "http",
            "url": "https://mcp.github.com/v1",
            "auth": "oauth"
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
| `http` | Remote MCP servers. Streamable HTTP (SSE deprecating). |
| `inproc` | Bundled with Me Write Code; zero spawn, lowest latency. |

## OAuth 2.1

Servers that require auth use the **two-tool pattern**:

1. The model calls `<server>__authenticate` — returns an OAuth URL.
2. The user opens the URL, completes auth.
3. The model calls `<server>__complete_authentication` to finalize.

Tokens land in your OS keychain (via `keytar`). Re-auth on token expiry is automatic.

## Tool namespacing

MCP tools are namespaced as `mcp__<server>__<tool>` to avoid collisions. The model sees them under their registered names; the system prompt explains the namespace convention.

## Schema deferral (ToolSearch)

By default Me Write Code only lists MCP tool **names** in the always-on context. Schemas are fetched on demand via `ToolSearch`. This matches Anthropic's pattern and cuts ~85% of context bloat.

## Warm pool

Idle stdio MCP servers are SIGSTOP'd to reclaim memory. They're SIGCONT'd on the next call. Eviction policy: LRU, max idle 10 minutes.

## Me Write Code as MCP server

```bash
mewrite mcp-server
```

Exposes Me Write Code's coding-agent tools to other MCP clients (Claude Desktop, Codex, opencode). Useful for multi-agent setups where Me Write Code is the "executor" and another agent is the planner.

## Importing Claude Code / Codex MCP config

Me Write Code reads `.mcp.json` at the project root (Claude Code / Codex format). No conversion needed.

```bash
cp .claude.json .mcp.json   # if you had a Claude-only config in the same shape
```

## Troubleshooting

- **`mewrite mcp doctor`** — pings every configured server, reports timeouts and auth failures.
- **`mewrite mcp logs <server>`** — tails the stderr of a stdio server.
- **Server crashes loop** — Me Write Code backs off to 1 / 5 / 30 minute retry intervals; you'll see a doctor warning.
