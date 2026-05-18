/**
 * WS9 Daemon — public surface.
 *
 * Re-exports the server, client, and protocol shapes. The CLI subcommands
 * (`caveman serve`, `caveman attach`, `cave list`, `cave worker`) consume from
 * here.
 */

export { AttachedSession, CaveClient, type ClientOptions } from "./client.js";
export * from "./protocol.js";
export { createDefaultRunnerFactory } from "./runner.js";
export {
	type AgentRunner,
	type DaemonHandle,
	type DaemonOptions,
	type RunnerEmitter,
	type RunnerEvent,
	type RunnerFactory,
	startDaemon,
} from "./server.js";
export { openStore, type SessionStore, SqliteSessionStore } from "./store.js";
