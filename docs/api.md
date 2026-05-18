---
title: API Reference
description: SDK, JSON-RPC, OpenAPI, and embedding cave in your own apps.
---

# API Reference

Caveman Code exposes four programmatic surfaces. Pick whichever matches your integration.

<CopyForLlms />

## 1. Node SDK — `caveman` import

```typescript
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
} from "caveman-code";

const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: AuthStorage.create(),
    modelRegistry: ModelRegistry.create(AuthStorage.create()),
});

const result = await session.prompt("What files are in the current directory?");
console.log(result.text);
```

Useful for: building a custom UI on top of caveman-code's runtime, embedding cave in a larger app, scripted batch runs.

Full TypeScript types are exported from the `caveman` package. See [packages/coding-agent](https://github.com/JuliusBrussee/caveman-cli/tree/main/packages/coding-agent) for source.

## 2. Daemon SDK — `@caveman-code/sdk`

```bash
npm install @caveman-code/sdk
```

```typescript
import { CaveClient } from "@caveman-code/sdk";

const client = new CaveClient({
    host: "localhost:39245",
    token: process.env.CAVE_TOKEN,
});

const session = await client.sessions.create({
    model: "claude-sonnet-4",
    cwd: "/path/to/repo",
});

await session.prompt("explain this codebase");

for await (const event of session.events()) {
    if (event.type === "token") process.stdout.write(event.text);
    if (event.type === "tool_call") console.error("[tool]", event.name);
    if (event.type === "done") break;
}
```

The `@caveman-code/sdk` package is generated from the daemon's OpenAPI spec. See [Daemon](/reference/daemon) for the protocol details.

## 3. JSON-RPC over stdin/stdout

```bash
caveman --mode rpc
```

JSONL on stdin, JSONL on stdout. One request per line.

Methods:

| Method | Purpose |
|---|---|
| `session.create` | Start a new session |
| `session.prompt` | Send a user turn |
| `session.events` | Subscribe to events (server-streamed) |
| `session.tool.allow` | Respond to a permission prompt |
| `session.compact` | Manual compaction |
| `session.fork` | Branch the session |
| `session.close` | Close and persist |

Example:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"session.create","params":{"model":"claude-sonnet-4"}}
{"jsonrpc":"2.0","id":2,"method":"session.prompt","params":{"sessionId":"abc","text":"hello"}}
```

Useful for: integrating cave with editors (LSP-style), building shell scripts that pipe through caveman-code, writing other-language clients.

## 4. Print mode + JSON output

For one-shot integrations:

```bash
caveman -p "summarize this file" < src/foo.ts
caveman --mode json "list todos in this repo"
caveman exec "lint and fix" --output-schema schema.json
```

`--output-schema` validates the model's final response against a JSON Schema. Useful for CI gates.

Stable JSON event stream:

```jsonl
{"type":"session.start","sessionId":"abc","model":"claude-sonnet-4"}
{"type":"tool.call","tool":"Read","args":{"path":"src/foo.ts"}}
{"type":"tool.result","tool":"Read","ok":true}
{"type":"token","text":"This file..."}
{"type":"session.end","cost":0.012,"tokens":{"in":1200,"out":80}}
```

The schema is versioned. Pin `--protocol-version=v1` for stability across cave releases.

## OpenAPI spec

The daemon serves its own OpenAPI 3.1 spec:

```bash
caveman serve &
curl http://localhost:39245/openapi.yaml
```

Or browse the spec on GitHub: [packages/coding-agent/openapi.yaml](https://github.com/JuliusBrussee/caveman-cli/blob/main/packages/coding-agent/openapi.yaml).

## Extension API (in-process)

If you'd rather load TypeScript modules at session start:

```typescript
// .cave/extensions/my-ext.ts
import type { ExtensionAPI } from "caveman-code";

export default function (api: ExtensionAPI) {
    api.registerTool({ name: "deploy", schema: { ... }, handler: async (args) => { ... } });
    api.registerCommand("stats", { handler: async () => "..." });
    api.on("tool_call", async (event, ctx) => {
        // ...
    });
}
```

40+ event types. Full docs at [packages/coding-agent/docs/extensions.md](https://github.com/JuliusBrussee/caveman-cli/blob/main/packages/coding-agent/docs/extensions.md).

## Choosing a surface

| Use case | Surface |
|---|---|
| Embed in a Node app | SDK (`caveman` import) |
| Build a remote client | `@caveman-code/sdk` over the daemon |
| Editor integration | JSON-RPC `--mode rpc` |
| CI / GitHub Actions | `caveman exec --output-schema` |
| In-process custom tool | Extension API |
| Observe sessions live | `caveman attach --json-events` |
