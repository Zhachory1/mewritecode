---
title: API Reference
description: SDK, JSON-RPC, OpenAPI, and embedding Me Write Code in your own apps.
---

# API Reference

Me Write Code exposes four programmatic surfaces. Pick whichever matches your integration.

<CopyForLlms />

## 1. Node SDK — `mewrite` import

```typescript
import {
    AuthStorage,
    createAgentSession,
    ModelRegistry,
    SessionManager,
} from "@zhachory1/mewrite-code";

const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage: AuthStorage.create(),
    modelRegistry: ModelRegistry.create(AuthStorage.create()),
});

const result = await session.prompt("What files are in the current directory?");
console.log(result.text);
```

Useful for: building a custom UI on top of Me Write Code's runtime, embedding the agent loop in a larger app, or scripted batch runs.

Full TypeScript types are exported from the `mewrite` package. See [packages/coding-agent](https://github.com/Zhachory1/mewritecode/tree/main/packages/coding-agent) for source.

## 2. Daemon SDK — `@zhachory1/mewrite-sdk`

```bash
npm install @zhachory1/mewrite-sdk
```

```typescript
import { CaveClient } from "@zhachory1/mewrite-sdk";

const client = new CaveClient({
    host: "localhost",
    port: 7421,
    token: process.env.MEWRITE_TOKEN,
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

The `@zhachory1/mewrite-sdk` package is generated from the daemon's OpenAPI spec. See [Daemon](/reference/daemon) for the protocol details.

## 3. RPC over stdin/stdout

```bash
mewrite --mode rpc
```

RPC mode uses JSONL commands with a `type` field, not JSON-RPC 2.0 method names. See [packages/coding-agent/docs/rpc.md](https://github.com/Zhachory1/mewritecode/blob/main/packages/coding-agent/docs/rpc.md) for the current command and event schema.

Useful for: editor integrations, shell scripts that pipe through Me Write Code, and clients in other languages.

## 4. Print mode + JSON output

For one-shot integrations:

```bash
mewrite -p "summarize this file" < src/foo.ts
mewrite --mode json "list todos in this repo"
mewrite exec "lint and fix" --output-schema schema.json
```

`--output-schema` validates the model's final response against a JSON Schema. Useful for CI gates.

`mewrite exec --json` emits JSONL events such as:

```jsonl
{"type":"session.start","session_id":"<uuid>","cwd":"/path/to/project"}
{"type":"message.user","content":"List all TypeScript files"}
{"type":"tool.call","name":"bash","input":{"command":"find src -name '*.ts'"},"id":"call-1"}
{"type":"tool.result","id":"call-1","ok":true,"output":"src/index.ts\n"}
{"type":"message.assistant","content":"...","cost":{}}
{"type":"session.end","exit":0,"cost":{"input_tokens":100,"output_tokens":50,"total_cost_usd":0.001}}
```

See [exec docs](https://github.com/Zhachory1/mewritecode/blob/main/packages/coding-agent/docs/exec.md) for the full schema.

## OpenAPI spec

The packaged OpenAPI 3.0.3 spec is available in the repository: [packages/coding-agent/openapi.yaml](https://github.com/Zhachory1/mewritecode/blob/main/packages/coding-agent/openapi.yaml). The running daemon does not currently serve `/openapi.yaml`.

## Extension API (in-process)

If you'd rather load TypeScript modules at session start:

```typescript
// .mewrite/extensions/my-ext.ts
import type { ExtensionAPI } from "@zhachory1/mewrite-code";

export default function (api: ExtensionAPI) {
    api.registerTool({ name: "deploy", schema: { ... }, handler: async (args) => { ... } });
    api.registerCommand("stats", { handler: async () => "..." });
    api.on("tool_call", async (event, ctx) => {
        // ...
    });
}
```

40+ event types. Full docs at [packages/coding-agent/docs/extensions.md](https://github.com/Zhachory1/mewritecode/blob/main/packages/coding-agent/docs/extensions.md).

## Choosing a surface

| Use case | Surface |
|---|---|
| Embed in a Node app | SDK (`mewrite` import) |
| Build a remote client | `@zhachory1/mewrite-sdk` over the daemon |
| Editor integration | JSON-RPC `--mode rpc` |
| CI / GitHub Actions | `mewrite exec --output-schema` |
| In-process custom tool | Extension API |
| Observe sessions live | `mewrite attach --json-events` |
