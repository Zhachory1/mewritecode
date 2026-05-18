/**
 * WS9 — `caveman attach <session-id>` subcommand.
 *
 * Connects to a running daemon's WS endpoint for the given session,
 * streams tokens to stdout in real time, and forwards stdin lines as user
 * messages. Multiple `caveman attach` clients can be connected to the same
 * session simultaneously (multi-client attach is the WS9 headline feature).
 *
 * Sessions survive SSH drops because the daemon keeps running; the user
 * just runs `caveman attach <id>` again to resume.
 */

import { createInterface } from "node:readline";
import chalk from "chalk";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../core/daemon/index.js";

interface AttachArgs {
	host: string;
	port: number;
	token?: string;
	sessionId?: string;
	noInput: boolean;
	help?: boolean;
}

function parseAttachArgs(args: string[]): AttachArgs {
	const out: AttachArgs = {
		host: process.env.CAVE_DAEMON_HOST ?? DEFAULT_DAEMON_HOST,
		port: process.env.CAVE_DAEMON_PORT ? Number.parseInt(process.env.CAVE_DAEMON_PORT, 10) : DEFAULT_DAEMON_PORT,
		token: process.env.CAVE_DAEMON_TOKEN,
		noInput: false,
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
			case "--no-input":
				out.noInput = true;
				break;
			case "--help":
			case "-h":
				out.help = true;
				break;
			default:
				if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
				if (!out.sessionId) out.sessionId = a;
		}
	}
	return out;
}

function printHelp(): void {
	console.log(`Usage: caveman attach <session-id> [options]

Attach to a running daemon session. Streams assistant tokens to stdout and
sends typed lines back to the session as user messages. Multi-client safe.

Options:
  --host <ip>      Daemon host (default 127.0.0.1, env CAVE_DAEMON_HOST)
  --port <n>       Daemon port (default 7421, env CAVE_DAEMON_PORT)
  --token <s>      Bearer token (env CAVE_DAEMON_TOKEN)
  --no-input       Read-only attach (don't forward stdin)
  -h, --help       Show this help`);
}

export async function runAttach(args: string[]): Promise<number> {
	let parsed: AttachArgs;
	try {
		parsed = parseAttachArgs(args);
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		printHelp();
		return 1;
	}
	if (parsed.help) {
		printHelp();
		return 0;
	}
	if (!parsed.sessionId) {
		console.error(chalk.red("Error: missing <session-id>"));
		printHelp();
		return 1;
	}
	const client = new CaveClient({ host: parsed.host, port: parsed.port, token: parsed.token });
	// Confirm the session exists before opening WS so the error is friendlier.
	try {
		await client.getSession(parsed.sessionId);
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

	const session = client.attach(parsed.sessionId);
	const sessionId = parsed.sessionId;
	let exitCode = 0;

	session.on("token", (params) => {
		if (params?.sessionId === sessionId && typeof params.text === "string") {
			process.stdout.write(params.text);
		}
	});
	session.on("done", () => {
		process.stdout.write("\n");
	});
	session.on("state", (params) => {
		if (params?.state === "error") {
			console.error(chalk.red("\n[session entered error state]"));
		}
	});
	session.on("error", (err) => {
		console.error(chalk.red(`\n[ws error] ${err.message}`));
		exitCode = 1;
	});
	const closed = new Promise<void>((resolve) => session.on("close", () => resolve()));

	try {
		await session.ready();
	} catch {
		console.error(chalk.red("Failed to attach (WS connect)."));
		return 1;
	}

	console.error(chalk.dim(`[attached to ${sessionId}; Ctrl-C to detach]`));

	if (!parsed.noInput && process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stderr, prompt: "> " });
		rl.prompt();
		rl.on("line", async (line) => {
			const text = line.trim();
			if (!text) {
				rl.prompt();
				return;
			}
			try {
				await session.send(text);
			} catch (err) {
				console.error(chalk.red(`send error: ${err instanceof Error ? err.message : err}`));
			}
			rl.prompt();
		});
		rl.on("close", () => {
			session.close();
		});
	}

	process.once("SIGINT", () => {
		session.close();
	});

	await closed;
	return exitCode;
}

export async function handleAttachCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "attach") return false;
	const code = await runAttach(args.slice(1));
	process.exit(code);
}
