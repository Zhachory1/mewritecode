/**
 * Live PTY agent ownership for the agents view (Option A).
 *
 * Each spawned agent is a full interactive `mewrite` running under a pseudo-
 * terminal whose master fd lives in the viewer process. The `LivePtyAgent` holds
 * the pty + an `@xterm/headless` emulator so output keeps accumulating while the
 * user navigates away from the pane; `PtyAgentManager` keeps them keyed by id and
 * kills them all on viewer exit (agents die with the viewer — no daemon).
 *
 * node-pty is a native module and cannot be driven under Bun; loading is guarded
 * so a runtime without a working node-pty degrades (no live agents) instead of
 * throwing into the agents view.
 */

import { createRequire } from "node:module";
import type { IMarker, Terminal as XtermTerminal } from "@xterm/headless";
// @xterm/headless is CommonJS. Its CJS<->ESM interop differs by loader: Node's
// ESM exposes `Terminal` on the default export, while tsx exposes it as a named
// export and leaves `default` undefined. Import the whole namespace and pick
// whichever shape is present so this works under Node (built dist), tsx, and
// vitest alike.
import * as xtermHeadless from "@xterm/headless";
import type { IPty } from "node-pty";
import type { PtyBuffer } from "./pty-render.js";

type TerminalCtor = new (opts: { cols: number; rows: number; allowProposedApi?: boolean }) => XtermTerminal;

const ns = xtermHeadless as unknown as {
	Terminal?: TerminalCtor;
	default?: { Terminal?: TerminalCtor } & TerminalCtor;
};
const Terminal: TerminalCtor = (ns.Terminal ?? ns.default?.Terminal ?? ns.default) as TerminalCtor;

export interface PtySpawn {
	file: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
}

/** Lazily-resolved node-pty spawn, or null if unusable in this runtime. */
type NodePtySpawn = (file: string, args: string[], opts: Record<string, unknown>) => IPty;
let cachedSpawn: NodePtySpawn | null | undefined;

function loadPtySpawn(): NodePtySpawn | null {
	if (cachedSpawn !== undefined) return cachedSpawn;
	try {
		// require so a load/ABI failure surfaces here, not at import time.
		const require = createRequire(import.meta.url);
		const mod = require("node-pty") as { spawn: NodePtySpawn };
		// Probe once: fork can still fail even when the module loads (e.g. a non-
		// executable spawn-helper throws `posix_spawnp failed`). A failed probe
		// disables the live path so the caller falls back to headless agents rather
		// than spawning agents that all fail to start.
		const probe = mod.spawn(process.execPath, ["-e", "0"], { cols: 80, rows: 24 });
		probe.kill();
		cachedSpawn = mod.spawn;
	} catch {
		cachedSpawn = null;
	}
	return cachedSpawn;
}

/** True when node-pty is usable in this runtime. */
export function ptyAvailable(): boolean {
	return loadPtySpawn() !== null;
}

export class LivePtyAgent {
	private pty: IPty | null = null;
	readonly term: XtermTerminal;
	private disposed = false;
	exited = false;
	exitCode: number | null = null;
	cols: number;
	rows: number;
	private onRender: (() => void) | null = null;

	constructor(spawn: PtySpawn, cols: number, rows: number) {
		this.cols = Math.max(1, cols);
		this.rows = Math.max(1, rows);
		this.term = new Terminal({ cols: this.cols, rows: this.rows, allowProposedApi: true });
		const doSpawn = loadPtySpawn();
		if (!doSpawn) {
			this.exited = true;
			this.term.write("\r\n[node-pty unavailable in this runtime]\r\n");
			return;
		}
		try {
			this.pty = doSpawn(spawn.file, spawn.args, {
				name: "xterm-256color",
				cols: this.cols,
				rows: this.rows,
				cwd: spawn.cwd,
				env: spawn.env ?? process.env,
			});
		} catch (err) {
			this.exited = true;
			this.term.write(`\r\n[failed to start pty: ${err instanceof Error ? err.message : String(err)}]\r\n`);
			return;
		}
		this.pty.onData((data) => {
			if (this.disposed) return;
			this.term.write(data, () => this.onRender?.());
		});
		this.pty.onExit(({ exitCode }) => {
			this.exited = true;
			this.exitCode = exitCode;
			this.onRender?.();
		});
	}

	/** Register the render callback for the currently-focused pane (single subscriber). */
	setRenderCallback(cb: (() => void) | null): void {
		this.onRender = cb;
	}

	get buffer(): PtyBuffer {
		return this.term.buffer.active as unknown as PtyBuffer;
	}

	/**
	 * Register a marker tracking `absRow` (an absolute buffer row) as scrollback is
	 * trimmed. The marker's `.line` follows the pinned row and becomes -1 once that
	 * row is evicted past the scrollback cap. Caller owns disposal. Used by the
	 * pane to hold a scrolled-back viewport steady while output keeps arriving.
	 * Returns null when a marker can't be registered (offset out of range, or the
	 * child is on its alt buffer) — the pane treats that as "follow the tail".
	 */
	markRow(absRow: number): IMarker | null {
		const b = this.term.buffer.active;
		const cursorAbs = b.baseY + b.cursorY;
		return this.term.registerMarker(absRow - cursorAbs) ?? null;
	}

	/** OS pid of the child process (matches the session's live-registry pid), or null. */
	get pid(): number | null {
		return this.pty?.pid ?? null;
	}

	write(data: string): void {
		if (this.exited) return;
		this.pty?.write(data);
	}

	resize(cols: number, rows: number): void {
		const c = Math.max(1, cols);
		const r = Math.max(1, rows);
		if (c === this.cols && r === this.rows) return;
		this.cols = c;
		this.rows = r;
		this.term.resize(c, r);
		try {
			this.pty?.resize(c, r);
		} catch {
			/* best-effort: pty may have exited */
		}
	}

	kill(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.onRender = null;
		try {
			this.pty?.kill();
		} catch {
			/* already gone */
		}
		this.pty = null;
		this.term.dispose();
	}
}

/**
 * Owns all live pty agents for one agents-view session; kills them on exit.
 * Agents are keyed by child pid, which the spawned interactive `mewrite` also
 * publishes to the live-registry as the row pid — so list rows map to agents.
 */
export class PtyAgentManager {
	private readonly agents: LivePtyAgent[] = [];
	/** Pids of headless-fallback agents this viewer spawned (no pty), still owned. */
	private readonly headlessPids = new Set<number>();

	spawn(spawn: PtySpawn, cols: number, rows: number): LivePtyAgent {
		const agent = new LivePtyAgent(spawn, cols, rows);
		this.agents.push(agent);
		return agent;
	}

	/** Record a headless-fallback agent's pid so the scoped list still shows it. */
	ownHeadlessPid(pid: number): void {
		this.headlessPids.add(pid);
	}

	/** Find a live agent by child pid (rows are matched to agents this way). */
	getByPid(pid: number): LivePtyAgent | undefined {
		return this.agents.find((a) => a.pid === pid);
	}

	/** Child pids of all agents this viewer owns (pty + headless), for scoping the list. */
	ownedPids(): Set<number> {
		const pids = new Set<number>(this.headlessPids);
		for (const a of this.agents) {
			if (a.pid !== null) pids.add(a.pid);
		}
		return pids;
	}

	killAll(): void {
		for (const agent of this.agents) agent.kill();
		this.agents.length = 0;
	}
}
