/**
 * @caveman-code/sdk — TypeScript client for the cave daemon.
 *
 * Hand-written to match `packages/coding-agent/openapi.yaml`. We deliberately
 * avoid pulling in `@caveman-code/coding-agent` (which would force consumers to ship
 * the entire CLI). The types are duplicated by design — a future CI step will
 * regenerate this file from the OpenAPI spec via `openapi-typescript-codegen`.
 *
 * TODO(ws9-codegen): wire `npm run codegen` to regenerate from openapi.yaml
 * before the v2.1 cut.
 */

export { AttachedSession, CaveClient, type ClientOptions } from "./client.js";
export * from "./protocol.js";
