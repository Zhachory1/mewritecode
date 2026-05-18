/**
 * WS9 — `cave list` subcommand.
 *
 * Prints currently-known daemon sessions. Talks to the running daemon over
 * HTTP. If the daemon is not running, prints a helpful message instead of
 * crashing.
 */

import chalk from "chalk";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../core/daemon/index.js";

interface ListArgs {
	host: string;
	port: number;
	token?: string;
	state?: "idle" | "running" | "stopped" | "error";
	limit?: number;
	json: boolean;
	help?: boolean;
}

function parseListArgs(args: string[]): ListArgs {
	const out: ListArgs = {
		host: process.env.CAVE_DAEMON_HOST ?? DEFAULT_DAEMON_HOST,
		port: process.env.CAVE_DAEMON_PORT ? Number.parseInt(process.env.CAVE_DAEMON_PORT, 10) : DEFAULT_DAEMON_PORT,
		token: process.env.CAVE_DAEMON_TOKEN,
		json: false,
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
			case "--state":
				out.state = args[++i] as ListArgs["state"];
				break;
			case "--limit":
				out.limit = Number.parseInt(args[++i] ?? "", 10) || undefined;
				break;
			case "--json":
				out.json = true;
				break;
			case "--help":
			case "-h":
				out.help = true;
				break;
			default:
				if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
		}
	}
	return out;
}

function printHelp(): void {
	console.log(`Usage: cave list [options]

List daemon sessions.

Options:
  --host <ip>     Daemon host (default 127.0.0.1, env CAVE_DAEMON_HOST)
  --port <n>      Daemon port (default 7421, env CAVE_DAEMON_PORT)
  --token <s>     Bearer token (env CAVE_DAEMON_TOKEN)
  --state <s>     Filter by state: idle | running | stopped | error
  --limit <n>     Max rows (default 50, max 200)
  --json          JSON output
  -h, --help      Show this help`);
}

export async function runList(args: string[]): Promise<number> {
	let parsed: ListArgs;
	try {
		parsed = parseListArgs(args);
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		printHelp();
		return 1;
	}
	if (parsed.help) {
		printHelp();
		return 0;
	}
	const client = new CaveClient({ host: parsed.host, port: parsed.port, token: parsed.token });
	let sessions: Awaited<ReturnType<typeof client.listSessions>>;
	try {
		sessions = await client.listSessions({ state: parsed.state, limit: parsed.limit });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED")) {
			console.error(chalk.yellow(`No daemon listening on ${parsed.host}:${parsed.port}.`));
			console.error(chalk.dim(`Start one with: caveman serve`));
			return 2;
		}
		console.error(chalk.red(`Error: ${msg}`));
		return 1;
	}
	if (parsed.json) {
		console.log(JSON.stringify(sessions, null, 2));
		return 0;
	}
	if (sessions.length === 0) {
		console.log(chalk.dim("(no sessions)"));
		return 0;
	}
	console.log(chalk.bold("ID                                    STATE     UPDATED                    TITLE"));
	for (const s of sessions) {
		const id = s.id.padEnd(36);
		const state = (s.state ?? "idle").padEnd(9);
		const updated = s.updatedAt.padEnd(26);
		const title = s.title ?? "";
		console.log(`${id}  ${state}  ${updated}  ${title}`);
	}
	return 0;
}

/**
 * Dispatch hook. Canonical user-facing form is `caveman sessions`. We avoid
 * `cave list` — that already means "list installed extensions" via the
 * package-manager handler. The WS9 plan specified `cave list`, but to keep
 * the existing extension-list semantics intact we ship `caveman sessions` as
 * the canonical name and accept `cave ps` as a short alias (Docker-style).
 */
export async function handleListCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "sessions" && args[0] !== "ps") return false;
	const code = await runList(args.slice(1));
	process.exit(code);
}
