/**
 * WS9 — `mewrite serve` subcommand.
 *
 * Boots the daemon (HTTP + WS) on the requested port. Persists sessions to
 * SQLite at `~/.cave/daemon/sessions.db`. Multi-client safe: any number of
 * `mewrite attach` clients (or `@zhachory1/mewrite-sdk`-using applications) can connect to
 * the same session over WS.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { getAgentDir, VERSION } from "../config.js";
import { dlog } from "../core/daemon/debug-log.js";
import { acquirePidfileLock } from "../core/daemon/pidfile-lock.js";
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
the same session. Single-instance: concurrent serve calls coordinate via atomic
pidfile lock; if a daemon is already running, the second caller exits cleanly.

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

	// Atomically acquire the pidfile lock before starting the daemon
	const lockResult = acquirePidfileLock(parsed.pidFile);
	if (!lockResult.ok) {
		if (lockResult.reason === "peer-alive") {
			dlog("serve", "lock.peerAlive", { pid: lockResult.pid });
			console.log(chalk.dim(`mewrite serve: already running (pid ${lockResult.pid}).`));
			// Another daemon owns the lock; this is success, not failure
			return 0;
		}
		// Unexpected error acquiring lock
		console.error(chalk.red("Error: failed to acquire pidfile lock."));
		return 1;
	}
	dlog("serve", "lock.acquired", { pid: process.pid, pidFile: parsed.pidFile });

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
		const isAddressInUse =
			err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
		if (isAddressInUse) {
			// Another daemon won the port; release our pidfile and exit cleanly
			try {
				rmSync(parsed.pidFile, { force: true });
			} catch {
				/* ignore */
			}
			dlog("serve", "bind.peerWon", { port: parsed.port });
			console.log(chalk.dim(`mewrite serve: port ${parsed.port} already bound by another daemon.`));
			store.close();
			return 0;
		}
		console.error(
			chalk.red(`Error: failed to bind ${parsed.host}:${parsed.port}: ${err instanceof Error ? err.message : err}`),
		);
		store.close();
		// Release pidfile on other errors too
		try {
			rmSync(parsed.pidFile, { force: true });
		} catch {
			/* ignore */
		}
		return 1;
	}

	// Pidfile already written by acquirePidfileLock

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
	// and keep serving.
	//
	// We deliberately do NOT auto-shut-down on a burst of errors. A previous
	// "spin guard" that shut the daemon down on high error frequency did far more
	// harm than good: normal usage (switching between agents mid-turn) could trip it,
	// and shutting down killed EVERY running agent's work. A busy or even briefly
	// spinning daemon the user can restart is strictly better than one that
	// self-terminates the whole fleet. We keep the SpinGuard purely to LOG when the
	// error rate looks pathological, for diagnosis — it never stops the process.
	const spinGuard = new SpinGuard();
	// Rate-limit fatal logging: a flapping socket can throw the same error thousands
	// of times a second; logging each one (sync appendFileSync + stderr) would itself
	// starve the loop. Coalesce bursts.
	let fatalLogCount = 0;
	let fatalWindowStart = 0;
	const onFatal = (label: string, detail: unknown): void => {
		const now = Date.now();
		if (now - fatalWindowStart > 1000) {
			fatalWindowStart = now;
			fatalLogCount = 0;
		}
		fatalLogCount++;
		const suppress = fatalLogCount > 20; // at most ~20 logged per second
		if (!suppress) {
			const text = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
			console.error(chalk.red(`mewrite serve: ${label} (continuing): ${text}`));
			// Record the real error so intermittent crashes are diagnosable (an
			// auto-started daemon's stdout is not captured).
			dlog("serve", `fatal.${label.replace(/\s+/g, "_")}`, { err: text });
		}
		if (spinGuard.record()) {
			// Log-only: surface a likely spin for diagnosis, but keep serving so agents
			// are never taken down by the guard itself.
			console.error(
				chalk.red(
					`mewrite serve: ${spinGuard.count} errors in a few seconds — possible spin (continuing to serve).`,
				),
			);
			dlog("serve", "spinGuard.highErrorRate", { count: spinGuard.count });
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
