/**
 * #152 — `mewrite agents`.
 *
 * Standalone read-only TUI monitor of daemon sessions ("agents"). Lists all
 * sessions with live state; selecting a row and pressing enter hands off to the
 * existing `attach` REPL, then returns to the list on detach.
 */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Component, Input, ProcessTerminal, setKeybindings, TUI, truncateToWidth } from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, type SessionRecord } from "../core/daemon/index.js";
import { KeybindingsManager } from "../core/keybindings.js";
import { type LiveRecord, listLiveInteractive } from "../core/live-registry.js";
import { getDefaultSessionDir, SessionManager } from "../core/session-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { showConfirmPrompt } from "../modes/interactive/components/confirm-prompt.js";
import type { TranscriptLine } from "../modes/interactive/components/transcript-view.js";
import { TwoPaneView } from "../modes/interactive/components/two-pane-view.js";
import { initTheme, theme } from "../modes/interactive/theme/theme.js";
import { runAttach } from "./attach.js";

const POLL_MS = 1000;

export interface AgentsArgs {
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

export function liveToRecord(rec: LiveRecord): SessionRecord {
	return {
		id: rec.id,
		createdAt: rec.updatedAt,
		updatedAt: rec.updatedAt,
		state: rec.state,
		cwd: rec.cwd,
		kind: "interactive",
	};
}

/**
 * Merge daemon-hosted sessions with live interactive sessions into one list.
 * A down daemon yields no hosted rows (rather than throwing) so live rows still show.
 */
export async function loadRows(client: Pick<CaveClient, "listSessions">): Promise<SessionRecord[]> {
	const [hosted, live] = await Promise.all([
		client
			.listSessions()
			.then((rows) =>
				rows.filter((r) => r.state !== "stopped").map((r): SessionRecord => ({ ...r, kind: "hosted" })),
			)
			.catch(() => [] as SessionRecord[]),
		listLiveInteractive(),
	]);
	const byId = new Map<string, SessionRecord>();
	for (const r of hosted) byId.set(r.id, r);
	// Interactive wins on id collision.
	for (const r of live) byId.set(r.id, liveToRecord(r));
	return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * True when an error (or any error in its `cause` chain) is a connection failure.
 * undici's `fetch` throws `TypeError: fetch failed` and carries the real
 * `ECONNREFUSED`/`ENOTFOUND` code in `error.cause`, so a top-level message match
 * is not enough.
 */
export function isDaemonUnreachable(err: unknown): boolean {
	const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT"];
	let cur: unknown = err;
	for (let depth = 0; cur && depth < 5; depth++) {
		const e = cur as { code?: string; message?: string; cause?: unknown };
		if (typeof e.code === "string" && codes.includes(e.code)) return true;
		if (typeof e.message === "string" && codes.some((c) => e.message?.includes(c))) return true;
		if (typeof e.message === "string" && e.message.includes("fetch failed")) return true;
		cur = e.cause;
	}
	return false;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(p): p is { type: "text"; text: string } =>
					!!p && typeof p === "object" && (p as { type?: string }).type === "text",
			)
			.map((p) => p.text)
			.join("");
	}
	return "";
}

/** Locate the JSONL transcript file for a live interactive session id. */
async function findInteractiveTranscript(cwd: string, id: string): Promise<string | null> {
	try {
		const dir = getDefaultSessionDir(cwd);
		const files = (await readdir(dir)).filter((f) => f.endsWith(`_${id}.jsonl`));
		if (files.length === 0) return null;
		files.sort();
		return join(dir, files[files.length - 1]);
	} catch {
		return null;
	}
}

/**
 * Read a session's transcript for the read-only detail pane. Interactive rows are
 * read from the local JSONL; hosted rows are fetched from the daemon. Best-effort:
 * a failure yields a single error line rather than throwing.
 */
export async function loadTranscript(
	row: SessionRecord,
	client: Pick<CaveClient, "getTranscript">,
): Promise<TranscriptLine[]> {
	try {
		if (row.kind === "interactive") {
			const path = await findInteractiveTranscript(row.cwd, row.id);
			if (!path) return [{ role: "error", text: "Transcript file not found." }];
			const messages = SessionManager.open(path).buildSessionContext().messages;
			return messages.map((m): TranscriptLine => {
				const role = m.role as TranscriptLine["role"];
				return { role, text: messageText((m as { content?: unknown }).content) };
			});
		}
		const transcript = await client.getTranscript(row.id);
		return transcript.messages.map((m): TranscriptLine => ({ role: m.role, text: m.text }));
	} catch (err) {
		return [{ role: "error", text: err instanceof Error ? err.message : String(err) }];
	}
}

function connFlags(parsed: AgentsArgs): string[] {
	const flags = ["--host", parsed.host, "--port", String(parsed.port)];
	if (parsed.token) flags.push("--token", parsed.token);
	return flags;
}

function isLoopbackHost(host: string): boolean {
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

const HEALTH_POLL_INTERVAL_MS = 100;

async function pollHealthy(client: CaveClient, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await client.health();
			return true;
		} catch {
			if (Date.now() >= deadline) return false;
			await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
		}
	}
}

/** Injectable daemon spawner; returns a stderr getter + cleanup. Real impl spawns
 * a detached `mewrite serve --runner agent`. */
export type DaemonSpawner = (parsed: AgentsArgs) => { getStderr: () => string; cleanup: () => void };

const realSpawner: DaemonSpawner = (parsed) => {
	const child = spawn(
		process.execPath,
		[process.argv[1], "serve", "--runner", "agent", "--host", parsed.host, "--port", String(parsed.port)],
		{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
	);
	let stderr = "";
	child.stderr?.on("data", (d) => {
		stderr += String(d);
	});
	return {
		getStderr: () => stderr,
		cleanup: () => {
			child.stderr?.destroy();
			child.unref();
		},
	};
};

/**
 * Ensure a healthy agent-runner daemon is reachable, auto-starting one if needed.
 * Health is the source of truth (a pidfile can name a recycled PID). Auto-start is
 * loopback-only. Returns the client, or an error code the caller should return.
 * Injectable client + spawner + timeout for testing.
 */
export async function ensureDaemon(
	parsed: AgentsArgs,
	client: CaveClient = new CaveClient({ host: parsed.host, port: parsed.port, token: parsed.token }),
	spawner: DaemonSpawner = realSpawner,
	timeoutMs = 5000,
): Promise<{ client: CaveClient } | { code: number }> {
	// Already up?
	try {
		await client.health();
		return { client };
	} catch (err) {
		if (!isDaemonUnreachable(err)) {
			console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
			return { code: 1 };
		}
	}

	// Only auto-start on loopback (non-loopback requires a token + explicit intent).
	if (!isLoopbackHost(parsed.host)) {
		console.error(chalk.yellow(`No daemon at ${parsed.host}:${parsed.port}.`));
		console.error(chalk.dim(`Start one with: mewrite serve --host ${parsed.host} --token <secret>`));
		return { code: 2 };
	}

	const child = spawner(parsed);
	const healthy = await pollHealthy(client, timeoutMs);
	if (!healthy) {
		// Another view may have won a race and bound the port; re-check once.
		try {
			await client.health();
			child.cleanup();
			return { client };
		} catch {
			/* genuinely failed */
		}
		console.error(chalk.red(`Auto-start failed (health timeout after ${Math.round(timeoutMs / 1000)}s).`));
		const stderr = child.getStderr().trim();
		if (stderr) console.error(chalk.dim(`  serve stderr: ${stderr}`));
		console.error(chalk.dim(`Start manually: mewrite serve --runner agent`));
		return { code: 2 };
	}
	child.cleanup();
	return { client };
}

/**
 * Spawn a new agent in the given cwd with a starting task. Returns the new session
 * id, or null on cancel / failure (a failure is surfaced to stderr by the caller).
 */
export async function spawnAgent(
	client: Pick<CaveClient, "createSession" | "send">,
	cwd: string,
	task: string,
): Promise<SessionRecord | null> {
	const trimmed = task.trim();
	if (!trimmed) return null;
	const session = await client.createSession({ cwd });
	await client.send(session.id, { text: trimmed });
	return session;
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

	// Ensure a healthy agent daemon (auto-start on loopback). Spawning agents needs it.
	const ensured = await ensureDaemon(parsed);
	if ("code" in ensured) {
		// If the daemon is unavailable but live interactive sessions exist, still show them.
		if ((await listLiveInteractive()).length > 0) {
			return runViewLoop(
				new CaveClient({ host: parsed.host, port: parsed.port, token: parsed.token }),
				parsed,
				false,
			);
		}
		return ensured.code;
	}
	const client = ensured.client;

	// Guard: an existing echo-mode daemon would make spawned agents silent no-ops.
	let canSpawn = true;
	try {
		const health = await client.health();
		if (health.capabilities.runnerKind !== "agent") {
			canSpawn = false;
			console.error(chalk.yellow(`Daemon at ${parsed.host}:${parsed.port} is running in 'echo' mode, not 'agent'.`));
			console.error(
				chalk.dim(`Spawning is disabled. Restart it: pkill -f 'mewrite serve'; mewrite serve --runner agent`),
			);
		}
	} catch {
		/* health raced away; treat as spawnable, errors surface on spawn */
	}

	setKeybindings(KeybindingsManager.create());
	initTheme(SettingsManager.create().getTheme());
	return runViewLoop(client, parsed, canSpawn);
}

async function runViewLoop(initialClient: CaveClient, parsed: AgentsArgs, canSpawn: boolean): Promise<number> {
	let client = initialClient;
	// Loop so each handoff rebuilds a fresh TUI (a stopped TUI is not reused).
	for (;;) {
		const action = await runListView(client, canSpawn);
		if (action.type === "quit") return 0;
		if (action.type === "new") {
			process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
			const task = await runNewAgentPrompt(process.cwd());
			process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
			if (task) {
				try {
					await spawnAgent(client, process.cwd(), task);
				} catch (err) {
					// The daemon may have died mid-session; re-ensure it once and retry.
					if (isDaemonUnreachable(err)) {
						const re = await ensureDaemon(parsed);
						if ("client" in re) {
							client = re.client;
							try {
								await spawnAgent(client, process.cwd(), task);
							} catch (err2) {
								console.error(
									chalk.red(`Failed to spawn agent: ${err2 instanceof Error ? err2.message : String(err2)}`),
								);
							}
						} else {
							console.error(chalk.red(`Failed to spawn agent: daemon unavailable and could not be started.`));
						}
					} else {
						console.error(
							chalk.red(`Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`),
						);
					}
				}
			}
			continue;
		}
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

type ListAction = { type: "quit" } | { type: "attach"; id: string } | { type: "new" };

function runListView(client: CaveClient, canSpawn: boolean): Promise<ListAction> {
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

		const poll = async (): Promise<void> => {
			try {
				view.setRows(await loadRows(client));
			} catch (err) {
				view.setPollError(err instanceof Error ? err.message : String(err));
			}
		};

		const confirmDelete = async (row: SessionRecord): Promise<void> => {
			const answer = await showConfirmPrompt(ui, {
				question: `Delete this agent session?`,
				detail: `${row.title ?? row.id.slice(0, 8)}  ${row.cwd}`,
				danger: true,
				defaultAnswer: "no",
			});
			if (answer === "yes") {
				try {
					await client.deleteSession(row.id);
				} catch (err) {
					view.setPollError(err instanceof Error ? err.message : String(err));
				}
				await poll();
			}
			ui.setFocus(view);
			ui.requestRender();
		};

		const view = new TwoPaneView(() => ui.requestRender(), {
			// enter on a hosted row hands off to the attach REPL (live-in-pane is 5b);
			// interactive rows are shown read-only in the focus pane already.
			onAttach: (row) => {
				if (row.kind !== "interactive") finish({ type: "attach", id: row.id });
			},
			onQuit: () => finish({ type: "quit" }),
			onNew: canSpawn ? () => finish({ type: "new" }) : undefined,
			onDelete: (row) => void confirmDelete(row),
			loadTranscript: (row) => loadTranscript(row, client),
			rows: () => process.stdout.rows || 24,
		});

		ui.addChild(view);
		ui.setFocus(view);
		ui.start();
		void poll();
		timer = setInterval(() => void poll(), POLL_MS);
	});
}

/**
 * Prompt for a starting task for a new agent. Returns the task text, or null on
 * cancel (esc) or empty submit. Header shows the spawn cwd so the user knows where
 * the agent will run.
 */
function runNewAgentPrompt(cwd: string): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let done = false;
		const finish = (value: string | null): void => {
			if (done) return;
			done = true;
			ui.stop();
			resolve(value);
		};

		const input = new Input();
		input.onSubmit = (value) => finish(value.trim() ? value : null);
		input.onEscape = () => finish(null);

		const header: Component = {
			invalidate() {},
			render: (width: number) => [
				theme.bold(truncateToWidth(`New agent in ${cwd}`, width)),
				theme.fg("dim", "Type a task and press enter · esc to cancel"),
			],
		};

		ui.addChild(header);
		ui.addChild(input);
		ui.setFocus(input);
		ui.start();
	});
}

export async function handleAgentsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "agents") return false;
	const code = await runAgents(args.slice(1));
	process.exit(code);
}
