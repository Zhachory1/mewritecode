/**
 * WS9 — `mewrite worker` subcommand family.
 *
 * Workers are remote `mewrite serve` daemons registered locally so the user
 * can prepend `&` to any prompt in interactive mode and have the session
 * dispatched to a registered remote worker (cloud handoff). The local
 * terminal frees up; later, the user runs `mewrite attach <id>` against the
 * worker URL to resume.
 *
 * Worker registry lives at `~/.mewrite/workers.json` (with legacy
 * `~/.cave/workers.json` read fallback). The local registry is separate from
 * the daemon's own SQLite worker table — `mewrite worker` does not require a
 * running local daemon, just the JSON file.
 */

import chalk from "chalk";
import {
	isValidWorkerName,
	readWorkers,
	safeWorkerOrigin,
	type WorkerEntry,
	type WorkersFile,
	writeWorkers,
} from "../core/worker-registry.js";

function printHelp(): void {
	console.log(`Usage: mewrite worker <subcommand>

Subcommands:
  register <name> --url <url> [--token <t>] [--label k=v ...]
                                    Register a remote Me Write Code daemon as a worker
  list                              List registered workers
  remove <name>                     Unregister a worker
  start [--port <n>] [--token <t>]  Run \`mewrite serve\` configured as a worker
                                    (alias for \`mewrite serve --token ...\`)

Workers persist to ~/.mewrite/workers.json. Legacy ~/.cave/workers.json is read if the new file does not exist.
Use \`&prompt\` in interactive mode to dispatch a prompt to the most recently registered worker.
Use \`mewrite attach --worker <name> <session-id>\` to attach to a dispatched worker session.`);
}

function parseLabels(args: string[], from: number): Record<string, string> {
	const labels: Record<string, string> = {};
	for (let i = from; i < args.length; i++) {
		const a = args[i];
		if (a === "--label") {
			const kv = args[++i] ?? "";
			const eq = kv.indexOf("=");
			if (eq > 0) labels[kv.slice(0, eq)] = kv.slice(eq + 1);
		}
	}
	return labels;
}

function doRegister(rest: string[]): number {
	const name = rest[0];
	if (!name || name.startsWith("--")) {
		console.error(chalk.red("Error: missing <name>"));
		printHelp();
		return 1;
	}
	if (!isValidWorkerName(name)) {
		console.error(chalk.red("Error: worker name may contain only letters, numbers, '.', '_', and '-'"));
		return 1;
	}
	let url: string | undefined;
	let token: string | undefined;
	for (let i = 1; i < rest.length; i++) {
		const a = rest[i];
		if (a === "--url") url = rest[++i];
		else if (a === "--token") token = rest[++i];
	}
	if (!url) {
		console.error(chalk.red("Error: --url is required"));
		return 1;
	}
	const labels = parseLabels(rest, 1);
	const file = readWorkers();
	const idx = file.workers.findIndex((w) => w.name === name);
	const entry: WorkerEntry = {
		name,
		url,
		token,
		labels: Object.keys(labels).length > 0 ? labels : undefined,
		registeredAt: new Date().toISOString(),
	};
	if (idx >= 0) file.workers[idx] = entry;
	else file.workers.push(entry);
	writeWorkers(file);
	console.log(chalk.green(`registered worker ${name} → ${safeWorkerOrigin(url)}`));
	return 0;
}

function doList(): number {
	const file = readWorkers();
	if (file.workers.length === 0) {
		console.log(chalk.dim("(no workers registered — try `mewrite worker register <name> --url ...`)"));
		return 0;
	}
	console.log(chalk.bold("NAME              URL                                  REGISTERED"));
	for (const w of file.workers) {
		console.log(`${w.name.padEnd(18)}${safeWorkerOrigin(w.url).padEnd(38)}${w.registeredAt}`);
	}
	return 0;
}

function doRemove(rest: string[]): number {
	const name = rest[0];
	if (!name) {
		console.error(chalk.red("Error: missing <name>"));
		return 1;
	}
	const file = readWorkers();
	const before = file.workers.length;
	file.workers = file.workers.filter((w) => w.name !== name);
	if (file.workers.length === before) {
		console.error(chalk.yellow(`worker ${name} not found`));
		return 1;
	}
	writeWorkers(file);
	console.log(chalk.green(`removed worker ${name}`));
	return 0;
}

async function doStart(rest: string[]): Promise<number> {
	// Alias for `mewrite serve` — a worker IS just a `mewrite serve` daemon.
	// We forward args directly so all `mewrite serve` flags are accepted.
	const { runServe } = await import("./serve.js");
	return runServe(rest);
}

export async function handleWorkerCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "worker") return false;
	const sub = args[1];
	const rest = args.slice(2);
	let exit = 0;
	try {
		switch (sub) {
			case "register":
			case "add":
				exit = doRegister(rest);
				break;
			case "list":
			case "ls":
			case undefined:
				exit = doList();
				break;
			case "remove":
			case "rm":
				exit = doRemove(rest);
				break;
			case "start":
				exit = await doStart(rest);
				break;
			case "help":
			case "--help":
			case "-h":
				printHelp();
				exit = 0;
				break;
			default:
				console.error(chalk.red(`Unknown worker subcommand: ${sub}`));
				printHelp();
				exit = 1;
		}
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		exit = 1;
	}
	process.exit(exit);
}

/** Internal helper for tests: read the registry. */
export function readWorkersForTest(): WorkersFile {
	return readWorkers();
}
