/**
 * WS9 — `cave worker` subcommand family.
 *
 * Workers are remote `caveman serve` daemons registered locally so the user
 * can prepend `&` to any prompt in interactive mode and have the session
 * dispatched to a registered remote worker (cloud handoff). The local
 * terminal frees up; later, the user runs `caveman attach <id>` against the
 * worker URL to resume.
 *
 * Worker registry lives at `~/.cave/workers.json`. The local registry is
 * separate from the daemon's own SQLite worker table — `cave worker` does
 * not require a running local daemon, just the JSON file. When a daemon
 * IS running locally, `cave worker register` ALSO posts the entry to
 * `/v1/workers` so listings stay consistent.
 *
 * P0 ships: register / list / remove / start (stub). The actual `&`-prefix
 * dispatch wiring belongs in interactive-mode (WS10's territory) — this
 * lands the registry plumbing only. TODO(ws9-worker-dispatch): wire
 * `&`-prefix in modes/interactive once WS10 surface stabilizes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";

interface WorkerEntry {
	name: string;
	url: string;
	token?: string;
	registeredAt: string;
	labels?: Record<string, string>;
}

interface WorkersFile {
	workers: WorkerEntry[];
}

function workersFilePath(): string {
	return join(homedir(), ".cave", "workers.json");
}

function readWorkers(): WorkersFile {
	const path = workersFilePath();
	if (!existsSync(path)) return { workers: [] };
	try {
		const raw = readFileSync(path, "utf8");
		return raw.trim() ? (JSON.parse(raw) as WorkersFile) : { workers: [] };
	} catch (err) {
		throw new Error(`failed to parse ${path}: ${err instanceof Error ? err.message : err}`);
	}
}

function writeWorkers(file: WorkersFile): void {
	const path = workersFilePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function printHelp(): void {
	console.log(`Usage: cave worker <subcommand>

Subcommands:
  register <name> --url <url> [--token <t>] [--label k=v ...]
                                    Register a remote cave daemon as a worker
  list                              List registered workers
  remove <name>                     Unregister a worker
  start [--port <n>] [--token <t>]  Run \`caveman serve\` configured as a worker
                                    (alias for \`caveman serve --token ...\`)

Workers persist to ~/.cave/workers.json. Use \`&prompt\` in interactive
mode to dispatch a prompt to the most recently used worker (TODO ws9-dispatch).`);
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
	console.log(chalk.green(`registered worker ${name} → ${url}`));
	return 0;
}

function doList(): number {
	const file = readWorkers();
	if (file.workers.length === 0) {
		console.log(chalk.dim("(no workers registered — try `cave worker register <name> --url ...`)"));
		return 0;
	}
	console.log(chalk.bold("NAME              URL                                  REGISTERED"));
	for (const w of file.workers) {
		console.log(`${w.name.padEnd(18)}${w.url.padEnd(38)}${w.registeredAt}`);
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
	// Alias for `caveman serve` — a worker IS just a `caveman serve` daemon.
	// We forward args directly so all `caveman serve` flags are accepted.
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
