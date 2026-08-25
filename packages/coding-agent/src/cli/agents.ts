/**
 * #152 — `mewrite agents`.
 *
 * Standalone read-only TUI monitor of daemon sessions ("agents"). Lists all
 * sessions with live state; selecting a row and pressing enter hands off to the
 * existing `attach` REPL, then returns to the list on detach.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type Component,
	type Focusable,
	getKeybindings,
	Image,
	Input,
	ProcessTerminal,
	setKeybindings,
	TUI,
	truncateToWidth,
} from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { APP_NAME, getAgentDir } from "../config.js";
import { sendAgentSteer } from "../core/agent-inbox.js";
import { CaveClient, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, type SessionRecord } from "../core/daemon/index.js";
import { KeybindingsManager } from "../core/keybindings.js";
import { type LiveRecord, listLiveInteractive } from "../core/live-registry.js";
import { getDefaultSessionDir, SessionManager } from "../core/session-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { type BannerLogo, loadBannerLogo, renderPencilLogo } from "../modes/interactive/components/banner.js";
import { promptClarify } from "../modes/interactive/components/clarify-prompt.js";
import { showConfirmPrompt } from "../modes/interactive/components/confirm-prompt.js";
import { type LivePtyAgent, PtyAgentManager, ptyAvailable } from "../modes/interactive/components/pty-agent.js";
import type { TranscriptLine } from "../modes/interactive/components/transcript-view.js";
import { TwoPaneView } from "../modes/interactive/components/two-pane-view.js";
import { initDistributionTheme, theme } from "../modes/interactive/theme/theme.js";

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

Status-grouped view of your agents. Press n to spawn a new agent (runs as an
independent process); select an interactive agent and press enter to resume it.

Options (daemon is optional; used only to show any daemon-hosted sessions):
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
		pid: rec.pid,
		title: rec.title,
	};
}

/**
 * Merge daemon-hosted sessions with live interactive sessions into one list.
 * A down daemon yields no hosted rows (rather than throwing) so live rows still show.
 *
 * `ownedPids`, when given, scopes live interactive rows to agents this viewer
 * spawned (Option A): foreign `mewrite` sessions in other terminals are excluded
 * so the list only shows agents the viewer owns (plus daemon-hosted rows). Omit
 * it to get the unscoped merge (used by the #152 merge tests).
 */
export async function loadRows(
	client: Pick<CaveClient, "listSessions">,
	ownedPids?: Set<number>,
): Promise<SessionRecord[]> {
	const [hosted, live] = await Promise.all([
		client
			.listSessions()
			.then((rows) =>
				rows.filter((r) => r.state !== "stopped").map((r): SessionRecord => ({ ...r, kind: "hosted" })),
			)
			.catch(() => [] as SessionRecord[]),
		listLiveInteractive(),
	]);
	const scopedLive = ownedPids ? live.filter((r) => ownedPids.has(r.pid)) : live;
	const byId = new Map<string, SessionRecord>();
	for (const r of hosted) byId.set(r.id, r);
	// Interactive wins on id collision.
	for (const r of scopedLive) byId.set(r.id, liveToRecord(r));
	// #221: stable ordering. `updatedAt` churns on every poll for active agents,
	// reshuffling rows under the cursor; `id` is stable across polls.
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
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

/**
 * Resume an interactive `[i]` session as a real interactive `mewrite` process
 * (replace-and-return): re-exec `mewrite --session <jsonl>` with the terminal
 * attached, wait for it to exit, then the caller rebuilds the list. The list TUI
 * is already stopped by the time this runs. Reuses the full interactive UI rather
 * than reimplementing it in a pane.
 */
async function resumeInteractive(row: SessionRecord): Promise<void> {
	const path = await findInteractiveTranscript(row.cwd, row.id);
	if (!path) {
		console.error(chalk.red(`Could not find a session file to resume for ${row.id.slice(0, 8)}.`));
		return;
	}
	// Clear before handing the screen to the interactive session.
	process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
	// Re-exec this same binary in --session mode. Mirrors resolveCaveInvocation in
	// task.ts: prefer the current script under the node/bun runtime.
	const script = process.argv[1];
	const command = script && existsSync(script) ? process.execPath : APP_NAME;
	const args = script && existsSync(script) ? [script, "--session", path] : ["--session", path];
	await new Promise<void>((resolve) => {
		const child = spawn(command, args, { cwd: row.cwd, stdio: "inherit" });
		child.on("error", (err) => {
			console.error(chalk.red(`Failed to resume session: ${err instanceof Error ? err.message : String(err)}`));
			resolve();
		});
		child.on("close", () => resolve());
	});
	// Clear the interactive session's output before the list is rebuilt.
	process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
}

/** Resolve how to invoke this same binary (script under node/bun, else PATH). */
function mewriteInvocation(): { file: string; baseArgs: string[] } {
	const script = process.argv[1];
	const useScript = script && existsSync(script);
	return useScript ? { file: process.execPath, baseArgs: [script] } : { file: APP_NAME, baseArgs: [] };
}

/**
 * Spawn a new agent as a live interactive `mewrite` under a pty (Option A). The
 * child is a full interactive session seeded with `task`; its pty master lives in
 * this viewer process, so the agent dies with the viewer. The child self-publishes
 * to the live-registry (own pid), so the list row matches this pty agent by pid.
 * Returns the LivePtyAgent, or null if node-pty is unavailable (caller falls back).
 */
export function spawnLiveAgent(manager: PtyAgentManager, cwd: string, task: string): LivePtyAgent | null {
	const trimmed = task.trim();
	if (!trimmed || !ptyAvailable()) return null;
	const { file, baseArgs } = mewriteInvocation();
	const cols = process.stdout.columns || 80;
	const rows = Math.max(1, (process.stdout.rows || 24) - 1);
	return manager.spawn({ file, args: [...baseArgs, trimmed], cwd, env: process.env }, cols, rows);
}

/**
 * Fallback: spawn a detached, headless `mewrite -p` agent (pre-pty behavior) when
 * node-pty is unavailable. Publishes to the live-registry (MEWRITE_AGENT_SPAWN) so
 * it shows in the list and stays a read-only monitored row. Returns the child pid
 * (so the viewer can scope the list to it), or null if not launched.
 */
export function spawnAgent(cwd: string, task: string): number | null {
	const trimmed = task.trim();
	if (!trimmed) return null;
	// Note: getAgentDir()/agents is the agent-DEFINITIONS dir; use a distinct dir
	// for spawned-agent output logs so we don't collide with `*.md` agent defs.
	const logDir = join(getAgentDir(), "agent-logs");
	mkdirSync(logDir, { recursive: true });
	const logPath = join(logDir, `${Date.now()}.log`);
	const out = openSync(logPath, "a");
	// Mirror resolveCaveInvocation (task.ts): prefer the current script under the
	// node/bun runtime, else the app binary on PATH.
	const script = process.argv[1];
	const useScript = script && existsSync(script);
	const command = useScript ? process.execPath : APP_NAME;
	const baseArgs = useScript ? [script] : [];
	const child = spawn(command, [...baseArgs, "-p", trimmed], {
		cwd,
		detached: true,
		stdio: ["ignore", out, out],
		env: { ...process.env, MEWRITE_AGENT_SPAWN: "1" },
	});
	child.unref();
	return child.pid ?? null;
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

	// Agents view v2 (#185): local agents are independent `mewrite` processes tracked
	// via the live-registry — no daemon required to spawn or run them. A daemon is used
	// only to surface any daemon-hosted `[d]` rows if one happens to be running; we
	// never auto-start one. Spawning is always available.
	const client = new CaveClient({ host: parsed.host, port: parsed.port, token: parsed.token });

	setKeybindings(KeybindingsManager.create());
	initDistributionTheme(SettingsManager.create().getTheme());
	return runViewLoop(client, true);
}

async function runViewLoop(client: CaveClient, canSpawn: boolean): Promise<number> {
	// One pty-agent manager owns all live agents for this viewer session; agents die
	// with the viewer (Option A). killAll() on quit tears them down.
	const manager = new PtyAgentManager();
	// Load the branding image logo once (if any); reused across each rebuilt TUI.
	const logo = await loadBannerLogo();
	try {
		// Loop so each handoff rebuilds a fresh TUI (a stopped TUI is not reused).
		for (;;) {
			const action = await runListView(client, canSpawn, manager, logo);
			if (action.type === "quit") return 0;
			if (action.type === "resume") {
				await resumeInteractive(action.row);
			}
		}
	} finally {
		manager.killAll();
	}
}

type ListAction = { type: "quit" } | { type: "resume"; row: SessionRecord };

/**
 * Spawn a new agent for `task` in `cwd`, preferring a live interactive pty agent
 * and falling back to a detached headless process when node-pty is unavailable
 * (e.g. under Bun). Either way the viewer owns the child so the scoped list shows
 * it. Returns an error message on failure, or null on success/no-op.
 */
function spawnNewAgent(manager: PtyAgentManager, cwd: string, task: string): string | null {
	if (!task.trim()) return null;
	try {
		if (!spawnLiveAgent(manager, cwd, task)) {
			const pid = spawnAgent(cwd, task);
			if (pid !== null) manager.ownHeadlessPid(pid);
		}
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/**
 * Agents view launch header. Renders the distribution's image logo when
 * `branding.logoPath` is set (matching the interactive banner), otherwise the
 * shared pencil logo + brand wordmark. Hidden while an interactive pty pane is
 * open so the embedded UI gets the full height. `rows` reports the actual header
 * height so the list-height math stays correct for either logo.
 */
class AgentsHeader implements Component {
	private readonly image?: Image;

	constructor(
		private readonly hidden: () => boolean,
		logo?: BannerLogo,
	) {
		if (logo) {
			this.image = new Image(
				logo.base64Data,
				logo.mimeType,
				{ fallbackColor: (text) => theme.fg("dim", text) },
				{ maxWidthCells: logo.maxWidthCells, filename: logo.filename },
			);
		}
	}

	/** Header height in rows (0 while hidden), used to size the list below it. */
	rows(width: number): number {
		if (this.hidden()) return 0;
		return this.render(width).length;
	}

	invalidate(): void {
		this.image?.invalidate?.();
	}

	render(width: number): string[] {
		if (this.hidden()) return [];
		if (this.image) return [...this.image.render(width), ""];
		return [...renderPencilLogo(width), ""];
	}
}

/**
 * Always-visible bottom-pinned "new agent" input bar, so spawning is an obvious,
 * ever-present affordance. `n` from the list focuses it; enter spawns and keeps
 * it in place; esc returns focus to the list. Owns an Input.
 */
class NewAgentBar implements Component, Focusable {
	focused = false;
	private readonly input = new Input();

	constructor(
		private readonly cwd: string,
		onSubmit: (task: string) => void,
		private readonly onLeave: () => void,
		/** When true the bar is suppressed (e.g. an interactive pty pane is open). */
		private readonly hidden: () => boolean = () => false,
	) {
		this.input.onSubmit = (value) => {
			const task = value.trim();
			this.input.setValue("");
			if (task) onSubmit(task);
			else onLeave();
		};
		this.input.onEscape = () => {
			this.input.setValue("");
			onLeave();
		};
	}

	/** Rows this bar occupies (top border + label + input + bottom border), or 0 suppressed. */
	get rows(): number {
		return this.hidden() ? 0 : 4;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		// Up-arrow (single-line input never uses it) returns focus to the list.
		if (kb.matches(data, "tui.select.up")) {
			this.onLeave();
			return;
		}
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate?.();
	}

	render(width: number): string[] {
		if (this.hidden()) return [];
		// Full-width horizontal rules above and below, matching the interactive prompt
		// editor. The border brightens (accent) while focused, dims otherwise.
		const borderColor = this.focused ? "accent" : "border";
		const bar = theme.fg(borderColor, "─".repeat(Math.max(1, width)));
		const hint = this.focused ? "↑ or esc to list · enter to spawn" : "↓ or n to add a new agent";
		const label = theme.fg("dim", truncateToWidth(`new agent in ${this.cwd} · ${hint}`, width));
		this.input.focused = this.focused;
		return [label, bar, ...this.input.render(width), bar];
	}
}

function runListView(
	client: CaveClient,
	canSpawn: boolean,
	manager: PtyAgentManager,
	logo?: BannerLogo,
): Promise<ListAction> {
	return new Promise<ListAction>((resolve) => {
		// Full-screen wipe so the launch is clean (matches the spawn-prompt wipe below).
		process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
		const ui = new TUI(new ProcessTerminal());
		let done = false;
		let timer: ReturnType<typeof setInterval> | null = null;

		const finish = (action: ListAction): void => {
			if (done) return;
			done = true;
			if (timer) clearInterval(timer);
			view.dispose();
			ui.stop();
			resolve(action);
		};

		let firstPoll = true;
		const poll = async (): Promise<void> => {
			try {
				const rows = await loadRows(client, manager.ownedPids());
				view.setRows(rows);
				// On first load with no agents, start in the input bar so it's immediately
				// obvious you can spawn one. Don't steal focus on later polls.
				if (firstPoll && rows.length === 0 && canSpawn) focusNewAgentBar();
				firstPoll = false;
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

		const steerAgent = async (row: SessionRecord): Promise<void> => {
			const text = await promptClarify(ui, {
				question: `redirect ${row.title ?? row.id.slice(0, 8)} — type a steering message`,
				allowFreeText: true,
			});
			if (text?.trim()) {
				try {
					sendAgentSteer(row.id, text.trim());
				} catch (err) {
					view.setPollError(err instanceof Error ? err.message : String(err));
				}
			}
			ui.setFocus(view);
			ui.requestRender();
		};
		const interruptAgent = (row: SessionRecord): void => {
			if (typeof row.pid === "number") {
				try {
					process.kill(row.pid, "SIGINT");
				} catch {
					/* already gone */
				}
			}
		};

		const focusList = (): void => {
			ui.setFocus(view);
			ui.requestRender();
		};
		const focusNewAgentBar = (): boolean => {
			if (view.isPtyPaneActive()) return false;
			ui.setFocus(newAgentBar);
			ui.requestRender();
			return true;
		};
		const agentsHeader = new AgentsHeader(() => view.isPtyPaneActive(), logo);
		const newAgentBar = new NewAgentBar(
			process.cwd(),
			(task) => {
				const err = spawnNewAgent(manager, process.cwd(), task);
				if (err) view.setPollError(`Failed to spawn agent: ${err}`);
				else void poll();
				// Keep focus on the bar so you can fire off several agents in a row.
				ui.requestRender();
			},
			focusList,
			() => view.isPtyPaneActive(),
		);

		const view = new TwoPaneView(() => ui.requestRender(), {
			onQuit: () => finish({ type: "quit" }),
			onNew: canSpawn ? () => void focusNewAgentBar() : undefined,
			onNavigateDownOffList: canSpawn ? focusNewAgentBar : undefined,
			onResume: (row) => finish({ type: "resume", row }),
			onSteer: (row) => void steerAgent(row),
			onInterrupt: (row) => interruptAgent(row),
			onDelete: (row) => void confirmDelete(row),
			getLivePtyAgent: (row) => (typeof row.pid === "number" ? manager.getByPid(row.pid) : undefined),
			loadTranscript: (row) => loadTranscript(row, client),
			attach: (id) => client.attach(id),
			client,
			// Reserve space for the wordmark header above the list so the combined
			// height doesn't overflow the terminal.
			// Reclaim the logo's rows when it's hidden (interactive pane open).
			// Subtract the header (unless a pty pane is open) and the always-present
			// new-agent bar so nothing overlaps.
			rows: () =>
				Math.max(
					1,
					(process.stdout.rows || 24) - agentsHeader.rows(process.stdout.columns || 80) - newAgentBar.rows,
				),
			sidebarSide: SettingsManager.create().getAgentsSidebarSide(),
		});

		ui.addChild(agentsHeader);
		ui.addChild(view);
		ui.addChild(newAgentBar);
		ui.setBottomPinnedChildren(1);
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
