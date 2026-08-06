/**
 * #152 — `mewrite agents`.
 *
 * Standalone read-only TUI monitor of daemon sessions ("agents"). Lists all
 * sessions with live state; selecting a row and pressing enter hands off to the
 * existing `attach` REPL, then returns to the list on detach.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ProcessTerminal, setKeybindings, TUI } from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, type SessionRecord } from "../core/daemon/index.js";
import { KeybindingsManager } from "../core/keybindings.js";
import { type LiveRecord, listLiveInteractive } from "../core/live-registry.js";
import { getDefaultSessionDir, SessionManager } from "../core/session-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { AgentListComponent } from "../modes/interactive/components/agent-list.js";
import { type TranscriptLine, TranscriptView } from "../modes/interactive/components/transcript-view.js";
import { initTheme } from "../modes/interactive/theme/theme.js";
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

	// Probe the daemon before entering the TUI. Only bail when the daemon is down
	// AND there are no live interactive sessions to show.
	try {
		await client.listSessions();
	} catch (err) {
		// If any live interactive sessions exist, enter the TUI regardless — loadRows
		// tolerates a down daemon and still shows them.
		if ((await listLiveInteractive()).length > 0) {
			// fall through into the TUI
		} else if (isDaemonUnreachable(err)) {
			console.error(chalk.yellow(`No daemon listening on ${parsed.host}:${parsed.port}.`));
			console.error(chalk.dim(`Start one with: mewrite serve`));
			return 2;
		} else {
			console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
			return 1;
		}
	}

	setKeybindings(KeybindingsManager.create());
	initTheme(SettingsManager.create().getTheme());

	// Loop so each handoff rebuilds a fresh TUI (a stopped TUI is not reused).
	for (;;) {
		const action = await runListView(client);
		if (action.type === "quit") return 0;
		if (action.type === "detail") {
			await runDetailView(action.row, client);
			// Wipe the transcript (screen + scrollback) so the list redraws clean.
			process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
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

type ListAction = { type: "quit" } | { type: "attach"; id: string } | { type: "detail"; row: SessionRecord };

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
			(row) => finish(row.kind === "interactive" ? { type: "detail", row } : { type: "attach", id: row.id }),
			() => finish({ type: "quit" }),
		);

		const poll = async (): Promise<void> => {
			try {
				list.setRows(await loadRows(client));
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

function runDetailView(row: SessionRecord, client: CaveClient): Promise<void> {
	return new Promise<void>((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let done = false;
		let timer: ReturnType<typeof setInterval> | null = null;

		const finish = (): void => {
			if (done) return;
			done = true;
			if (timer) clearInterval(timer);
			ui.stop();
			resolve();
		};

		const kind = row.kind === "interactive" ? "[i]" : "[d]";
		const title = `${kind} ${row.title ?? row.id.slice(0, 8)}  ${row.cwd}`;
		const view = new TranscriptView(title, () => ui.requestRender(), finish);

		const poll = async (): Promise<void> => {
			view.setLines(await loadTranscript(row, client));
		};

		ui.addChild(view);
		ui.setFocus(view);
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
