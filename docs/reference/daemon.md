---
title: Daemon
description: Run Me Write Code as a headless server. Multi-client attach. Sessions survive SSH drops.
---

# Daemon

`mewrite serve` starts a headless HTTP daemon that other Me Write Code clients (TUI, future desktop, future mobile) attach to. Sessions live in SQLite and survive SSH drops, machine sleep, and client crashes.

<CopyForLlms />

## Quick start

```bash
mewrite serve                                      # start the daemon on 127.0.0.1:7421
mewrite sessions                                   # list daemon sessions
mewrite attach <session-id> --host localhost --port 7421
```

By default `mewrite serve` binds to `127.0.0.1` only. For remote access, pass `--host 0.0.0.0 --token <secret>` and put it behind a TLS terminator. Token enforcement is opt-in today: omitting `--token` leaves the daemon unauthenticated.

## Architecture

```
┌─────────────────────────────┐         ┌─────────────────────┐
│  mewrite TUI (client)       │ ──HTTP─▶│  mewrite serve         │
│  mewrite attach <session-id>   │ ◀──WS── │   ├─ session store  │
└─────────────────────────────┘         │   │  (SQLite)        │
                                        │   ├─ session loop    │
┌─────────────────────────────┐         │   ├─ tool runtime    │
│  desktop client (future)    │ ──HTTP─▶│   └─ MCP clients     │
└─────────────────────────────┘         └─────────────────────┘
```

- **HTTP** for control-plane (start session, list, kill).
- **WebSocket** for streaming tokens, low-latency tool events.
- **SQLite** at `~/.mewrite/agent/daemon/sessions.db`.

## OpenAPI spec

The packaged OpenAPI 3.0.3 spec lives at `packages/coding-agent/openapi.yaml`. The generated TypeScript SDK is published as `@zhachory1/mewrite-sdk`:

```bash
npm install @zhachory1/mewrite-sdk
```

```typescript
import { CaveClient } from "@zhachory1/mewrite-sdk";

const client = new CaveClient({ host: "localhost:7421" });
const session = await client.sessions.create({ model: "claude-sonnet-4" });
await session.prompt("explain this codebase");
for await (const ev of session.events()) {
    console.log(ev);
}
```

## Worker mode (cloud handoff)

Register a remote `mewrite worker`:

```bash
# on the remote (e.g. a beefy GPU box)
mewrite worker start --host 0.0.0.0 --port 39246 --token <secret>

# locally, register
mewrite worker add gpu-rig --url http://gpu-rig:39246 --token <secret>
```

Worker registration/start is available. Interactive `&prompt` dispatch is still planned, so use workers only where your workflow explicitly calls the worker APIs.

## Multi-client

Multiple clients can attach to the same session. Edits stream to all attached clients in real-time. Useful for pair programming or for keeping a session open in your laptop's TUI while a desktop client tails it.

## Survive SSH drops

```bash
ssh box
mewrite serve &
mewrite sessions
mewrite attach <session-id>
# SSH drops
ssh box
mewrite attach <session-id>     # picks up exactly where you left off
```

The daemon survives client disconnects. Tool calls in flight complete; the next attach replays missed events.

## Stopping

```bash
mewrite serve --pid ~/.mewrite/agent/serve.pid
kill "$(cat ~/.mewrite/agent/serve.pid)"
```

`Ctrl+C` on the foreground `mewrite serve` stops it cleanly. If started in the background, stop the process with the pid file you chose. Active sessions checkpoint to disk.

## Security

- Default bind is `127.0.0.1` only.
- Pass `--token` for any non-loopback bind; the daemon does not enforce this automatically yet.
- WebSocket uses bearer auth only when a token is configured.
- TLS is your terminator's job — front the daemon with Caddy, nginx, or `cloudflared tunnel`.

## Limitations

- Daemon is **opt-in**. Most users run mewrite directly without it.
- Worker mode requires SSH-grade trust between local and remote.
- Not yet supported on Windows (preview Q3 2026).
