# `@caveman-code/sdk`

Thin TypeScript client for the `caveman serve` daemon. Mirrors the OpenAPI spec
shipped with `caveman` at `packages/coding-agent/openapi.yaml`.

```ts
import { CaveClient } from "@caveman-code/sdk";

const client = new CaveClient({ baseUrl: "http://127.0.0.1:7421", token: "..." });
const session = await client.createSession({ cwd: process.cwd() });
const ws = client.attach(session.id);
ws.on("token", (chunk) => process.stdout.write(chunk.text));
await client.send(session.id, "what does this codebase do?");
```

The hand-written client tracks the OpenAPI 3.0.3 spec by hand. Regeneration
hook is `npm run codegen` (TODO(ws9-codegen): wire `openapi-typescript-codegen`
in CI before v2.1).
