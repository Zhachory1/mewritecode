/**
 * #152 — `mewrite agents`.
 *
 * Standalone read-only TUI monitor of daemon sessions ("agents"). Lists all
 * sessions with live state; selecting a row and pressing enter hands off to the
 * existing `attach` REPL, then returns to the list on detach.
 */

import { ProcessTerminal, setKeybindings, TUI } from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../core/daemon/index.js";
import { KeybindingsManager } from "../core/keybindings.js";
import { AgentListComponent } from "../modes/interactive/components/agent-list.js";
import { runAttach } from "./attach.js";

const POLL_MS = 1000;

interface AgentsArgs {
	host: string;
	port: number;
	token?: string;
	help?: boolean;
}

function parseArgs(args: string[]): AgentsArgs {
	const out: AgentsArgs = {
		host: process.env.CAVE_DAEMON_HOST ?? DEFAULT_DAEMON_HOST,
		port: process.env.CAVE_DAEMON_PORT ? Number.parseInt(process.env.CAVE_DAEMON_PORT, 10) : DEFAULT_DAEMON_PORT,
		token: process.env.CAVE_DAEMON_TOKEN,
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
	console.log(`Usage: mewrite agents [options]

Interactive view of running daemon agents. Select one and press enter to attach.

Options:
  --host <ip>     Daemon host (default 127.0.0.1, env CAVE_DAEMON_HOST)
  --port <n>      Daemon port (default 7421, env CAVE_DAEMON_PORT)
  --token <s>     Bearer token (env CAVE_DAEMON_TOKEN)
  -h, --help      Show this help`);
}

function connFlags(parsed: AgentsArgs): string[] {
	const flags = ["--host", parsed.host, "--port", String(parsed.port)];
	if (parsed.token) flags.push("--token", parsed.token);
	return flags;
}

export async function runAgents(args: string[]): Promise<number> {
	let parsed: AgentsArgs;
	try {
		parsed = parseArgs(args);
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

	// Probe the daemon before entering the TUI so a down daemon prints a hint.
	try {
		await client.listSessions();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED")) {
			console.error(chalk.yellow(`No daemon listening on ${parsed.host}:${parsed.port}.`));
			console.error(chalk.dim(`Start one with: mewrite serve`));
			return 2;
		}
		console.error(chalk.red(`Error: ${msg}`));
		return 1;
	}

	setKeybindings(KeybindingsManager.create());

	// Loop so each attach handoff rebuilds a fresh TUI (a stopped TUI is not reused).
	for (;;) {
		const action = await runListView(client);
		if (action.type === "quit") return 0;
		// Hand off to the attach REPL. ui.stop() paused stdin; readline needs it flowing.
		process.stdin.resume();
		const code = await runAttach([action.id, ...connFlags(parsed)]);
		// runAttach returns 2 when the daemon is gone; don't loop back to a dead list.
		if (code === 2) {
			console.error(chalk.yellow(`No daemon listening on ${parsed.host}:${parsed.port}.`));
			return 2;
		}
	}
}

type ListAction = { type: "quit" } | { type: "attach"; id: string };

function runListView(client: CaveClient): Promise<ListAction> {
	return new Promise<ListAction>((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let done = false;
		let timer: ReturnType<typeof setInterval> | null = null;

		const finish = (action: ListAction): void => {
			if (done) return;
			done = true;
			if (timer) clearInterval(timer);
			ui.stop();
			resolve(action);
		};

		const list = new AgentListComponent(
			() => ui.requestRender(),
			(id) => finish({ type: "attach", id }),
			() => finish({ type: "quit" }),
		);

		const poll = async (): Promise<void> => {
			try {
				list.setRows(await client.listSessions());
			} catch (err) {
				// Keep last rows, but surface that the list may be stale.
				list.setPollError(err instanceof Error ? err.message : String(err));
			}
		};

		ui.addChild(list);
		ui.setFocus(list);
		ui.start();
		void poll();
		timer = setInterval(() => void poll(), POLL_MS);
	});
}

export async function handleAgentsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "agents") return false;
	const code = await runAgents(args.slice(1));
	process.exit(code);
}
