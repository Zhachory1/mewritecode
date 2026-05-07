---
title: Daemon
description: Run cave as a headless server. Multi-client attach. Sessions survive SSH drops.
---

# Daemon

`cave serve` starts a headless HTTP daemon that other Cave clients (TUI, future desktop, future mobile) attach to. Sessions live in SQLite and survive SSH drops, machine sleep, and client crashes.

<CopyForLlms />

## Quick start

```bash
cave serve --port 39245                          # start the daemon
cave attach --host localhost:39245               # attach a TUI to it
cave list                                        # list sessions
```

By default `cave serve` binds to `127.0.0.1` only. Use `--host 0.0.0.0` and a TLS terminator for remote access.

## Architecture

```
┌─────────────────────────────┐         ┌─────────────────────┐
│  cave TUI (client)          │ ──HTTP─▶│  cave serve         │
│  cave attach <session-id>   │ ◀──WS── │   ├─ session store  │
└─────────────────────────────┘         │   │  (SQLite)        │
                                        │   ├─ session loop    │
┌─────────────────────────────┐         │   ├─ tool runtime    │
│  cave-desktop (client)      │ ──HTTP─▶│   └─ MCP clients     │
└─────────────────────────────┘         └─────────────────────┘
```

- **HTTP** for control-plane (start session, list, kill).
- **WebSocket** for streaming tokens, low-latency tool events.
- **SQLite** at `~/.cave/serve/sessions.db`.

## OpenAPI spec

The daemon exposes an OpenAPI 3.1 spec at `GET /openapi.yaml`. The generated TypeScript SDK is published as `@cave/sdk`:

```bash
npm install @cave/sdk
```

```typescript
import { CaveClient } from "@cave/sdk";

const client = new CaveClient({ host: "localhost:39245" });
const session = await client.sessions.create({ model: "claude-sonnet-4" });
await session.prompt("explain this codebase");
for await (const ev of session.events()) {
    console.log(ev);
}
```

## Worker mode (cloud handoff)

Register a remote `cave worker`:

```bash
# on the remote (e.g. a beefy GPU box)
cave worker start --bind 0.0.0.0:39246 --token <secret>

# locally, register
cave worker add gpu-rig http://gpu-rig:39246 --token <secret>
```

Then prepend `&` to any prompt and it dispatches to the worker:

```
& refactor packages/agent/src/checkpoints to use the new index format
```

The local terminal frees up. The worker runs the session. Re-attach later:

```bash
cave list
cave attach <session-id>
```

## Multi-client

Multiple clients can attach to the same session. Edits stream to all attached clients in real-time. Useful for pair programming or for keeping a session open in your laptop's TUI while a desktop client tails it.

## Survive SSH drops

```bash
ssh box
cave serve &
cave attach <id>
# SSH drops
ssh box
cave attach <id>     # picks up exactly where you left off
```

The daemon survives client disconnects. Tool calls in flight complete; the next attach replays missed events.

## Stopping

```bash
cave serve stop
cave serve --pid-file ~/.cave/serve.pid stop
```

`Ctrl+C` on the foreground `cave serve` stops it cleanly. Active sessions checkpoint to disk.

## Security

- Default bind is `127.0.0.1` only.
- Tokens (`--token`) are required for any non-loopback bind.
- WebSocket uses bearer auth on connect.
- TLS is your terminator's job — front the daemon with Caddy, nginx, or `cloudflared tunnel`.

## Limitations

- Daemon is **opt-in**. Most users run cave directly without it.
- Worker mode requires SSH-grade trust between local and remote.
- Not yet supported on Windows (preview Q3 2026).
