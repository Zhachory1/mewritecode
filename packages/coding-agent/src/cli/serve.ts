/**
 * WS9 — `mewrite serve` subcommand.
 *
 * Boots the daemon (HTTP + WS) on the requested port. Persists sessions to
 * SQLite at `~/.cave/daemon/sessions.db`. Multi-client safe: any number of
 * `mewrite attach` clients (or `@zhachory1/mewrite-sdk`-using applications) can connect to
 * the same session over WS.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { getAgentDir, VERSION } from "../config.js";
import { dlog } from "../core/daemon/debug-log.js";
import {
	createAgentBackedRunnerFactory,
	createDefaultRunnerFactory,
	type DaemonHandle,
	openStore,
	SpinGuard,
	startDaemon,
} from "../core/daemon/index.js";

interface ServeArgs {
	host: string;
	port: number;
	token?: string;
	runner: "echo" | "agent";
	dbPath: string;
	pidFile: string;
	help?: boolean;
}

function parseServeArgs(args: string[]): ServeArgs {
	const out: ServeArgs = {
		host: "127.0.0.1",
		port: 7421,
		runner: "agent",
		dbPath: join(getAgentDir(), "daemon", "sessions.db"),
		pidFile: join(getAgentDir(), "daemon", "daemon.pid"),
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--host":
				out.host = args[++i] ?? out.host;
				break;
			case "--port":
				out.port = Number.parseInt(args[++i] ?? "", 10) || out.port;
				break;
			case "--token":
				out.token = args[++i];
				break;
			case "--runner": {
				const runner = args[++i];
				if (runner !== "echo" && runner !== "agent") throw new Error("--runner must be echo or agent");
				out.runner = runner;
				break;
			}
			case "--db":
				out.dbPath = args[++i] ?? out.dbPath;
				break;
			case "--pid":
				out.pidFile = args[++i] ?? out.pidFile;
				break;
			case "--help":
			case "-h":
				out.help = true;
				break;
			default:
				if (a.startsWith("--")) {
					throw new Error(`unknown flag: ${a}`);
				}
		}
	}
	return out;
}

function printHelp(): void {
	console.log(`Usage: mewrite serve [options]

Run the Me Write Code daemon (HTTP + WebSocket) and local web UI. Sessions
persist to SQLite and survive process restarts; multiple clients can attach to
the same session.

Options:
  --host <ip>     Bind host (default 127.0.0.1)
  --port <n>      Bind port (default 7421)
  --token <s>     Require Bearer <token> on every API/WebSocket request
  --runner <mode> agent (default) or echo
  --db <path>     SQLite session store (default ~/.cave/daemon/sessions.db)
  --pid <path>    Pid file (default ~/.cave/daemon/daemon.pid)
  -h, --help      Show this help

Web UI:
  GET  /                                     Experimental local browser UI

Endpoints:
  GET  /v1/health                            Liveness
  GET  /v1/sessions                          List sessions
  POST /v1/sessions                          Create session
  GET  /v1/sessions/:id                      Get session
  DEL  /v1/sessions/:id                      Delete session
  POST /v1/sessions/:id/messages             Send message
  GET  /v1/sessions/:id/transcript           Full transcript
  WS   /v1/sessions/:id/stream               JSON-RPC stream (token/tool/state/done)
  GET  /v1/fs/list?path=<abs>                Directory picker (defaults to $HOME)
  GET  /v1/workers                           List registered workers
  POST /v1/workers                           Register a worker
  DEL  /v1/workers/:name                     Unregister a worker

OpenAPI: see packages/coding-agent/openapi.yaml.`);
}

export async function runServe(args: string[]): Promise<number> {
	let parsed: ServeArgs;
	try {
		parsed = parseServeArgs(args);
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		printHelp();
		return 1;
	}
	if (parsed.help) {
		printHelp();
		return 0;
	}
	if (!parsed.token && !isLoopbackHost(parsed.host)) {
		console.error(chalk.red("Error: --token is required when --host is not loopback."));
		console.error(chalk.dim("Use the default 127.0.0.1 for local-only web UI, or pass --token <secret>."));
		return 1;
	}
	if (existsSync(parsed.pidFile)) {
		const existing = Number.parseInt(readFileSync(parsed.pidFile, "utf8").trim(), 10);
		if (!Number.isNaN(existing) && processAlive(existing)) {
			console.error(chalk.yellow(`mewrite serve: already running (pid ${existing}, pidfile ${parsed.pidFile}).`));
			console.error(chalk.dim(`Stop it first or remove ${parsed.pidFile}.`));
			return 1;
		}
	}

	const store = openStore(parsed.dbPath);
	const runnerFactory =
		parsed.runner === "agent"
			? createAgentBackedRunnerFactory({ loadHistory: (id) => store.getTranscript(id) })
			: createDefaultRunnerFactory();
	let handle: DaemonHandle;
	try {
		handle = await startDaemon({
			host: parsed.host,
			port: parsed.port,
			token: parsed.token,
			store,
			runnerFactory,
			version: VERSION,
			capabilities: { runnerKind: parsed.runner, approvalSupported: parsed.runner === "agent" },
		});
	} catch (err) {
		console.error(
			chalk.red(`Error: failed to bind ${parsed.host}:${parsed.port}: ${err instanceof Error ? err.message : err}`),
		);
		store.close();
		return 1;
	}

	mkdirSync(dirname(parsed.pidFile), { recursive: true });
	writeFileSync(parsed.pidFile, String(process.pid), "utf8");

	// Remove (not blank) the pidfile on any exit so a stale pidfile never outlives
	// the process. `ensureDaemon` treats health as source of truth, but a clean
	// pidfile avoids confusing operators and double-start races.
	const clearPidFile = (): void => {
		try {
			if (existsSync(parsed.pidFile) && readFileSync(parsed.pidFile, "utf8").trim() === String(process.pid)) {
				rmSync(parsed.pidFile, { force: true });
			}
		} catch {
			/* ignore */
		}
	};
	process.once("exit", clearPidFile);

	// The daemon hosts many independent agents in one process. A stray unhandled
	// error from one session (a torn WebSocket frame, a rejected background promise)
	// must NOT crash the daemon and take down every other agent's work — so we log
	// and keep serving. BUT a self-perpetuating error (e.g. a broken transport
	// retrying synchronously) would then spin the event loop at 100% CPU forever,
	// hanging every request. Guard against that: if exceptions fire too fast, the
	// daemon is wedged — shut down cleanly (reaping runners/MCP children) so it can
	// be auto-restarted fresh rather than spinning silently.
	const spinGuard = new SpinGuard();
	const onFatal = (label: string, detail: unknown): void => {
		const text = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
		console.error(chalk.red(`mewrite serve: ${label} (continuing): ${text}`));
		// Always record the actual error to the debug log so intermittent crashes are
		// diagnosable (stdout of an auto-started daemon is not captured).
		dlog("serve", `fatal.${label.replace(/\s+/g, "_")}`, { err: text, count: spinGuard.count + 1 });
		if (spinGuard.record()) {
			console.error(chalk.red(`mewrite serve: ${spinGuard.count} errors in a few seconds — forcing clean restart.`));
			dlog("serve", "spinGuard.tripped", { count: spinGuard.count });
			void shutdown("spin-guard");
		}
	};
	process.on("uncaughtException", (err) => onFatal("uncaught exception", err));
	process.on("unhandledRejection", (reason) => onFatal("unhandled rejection", reason));

	console.log(chalk.green(`mewrite serve listening on http://${handle.host}:${handle.port}`));
	console.log(chalk.dim(`  web:  http://${handle.host}:${handle.port}/`));
	console.log(chalk.dim(`  pid:  ${process.pid}`));
	console.log(chalk.dim(`  db:   ${parsed.dbPath}`));
	console.log(chalk.dim(`  runner: ${parsed.runner}`));
	if (parsed.token) {
		console.log(chalk.dim(`  auth: bearer (configured)`));
	} else {
		console.log(chalk.dim(`  auth: none (loopback only — pass --token to require Bearer auth)`));
	}
	console.log(chalk.dim(`  attach: mewrite attach <session-id>`));
	console.log(chalk.dim(`  list:   mewrite sessions`));

	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		const code = signal === "spin-guard" ? 1 : 0;
		console.error(chalk.dim(`\ncave serve: received ${signal}, shutting down...`));
		// Hard deadline: handle.close() awaits httpServer.close(), which blocks until
		// every keep-alive connection drains — that can hang indefinitely and leave a
		// half-open daemon (HTTP up, WS closed -> 503 on every attach, all sessions
		// error). Force-exit if graceful close doesn't finish quickly.
		const force = setTimeout(() => {
			console.error(chalk.red("cave serve: graceful shutdown timed out — forcing exit."));
			try {
				clearPidFile();
			} catch {
				/* ignore */
			}
			process.exit(code);
		}, 3000);
		force.unref();
		try {
			// Closes every runner -> disposes AgentSessions -> MCP hub closeAll(), so
			// no MCP subprocesses are orphaned on a clean shutdown.
			await handle.close();
			store.close();
			clearPidFile();
		} catch (err) {
			console.error("shutdown error:", err);
		}
		clearTimeout(force);
		process.exit(code);
	};
	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));

	// Hold the event loop open.
	await new Promise<void>(() => {
		/* never resolves */
	});
	return 0;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function isLoopbackHost(host: string): boolean {
	const h = host.toLowerCase();
	return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/**
 * Dispatch hook for `main.ts`. Returns true if the args were consumed.
 */
export async function handleServeCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "serve") return false;
	const code = await runServe(args.slice(1));
	process.exit(code);
}
