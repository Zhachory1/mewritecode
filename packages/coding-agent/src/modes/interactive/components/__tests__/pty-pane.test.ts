/**
 * While the agent runs, the pty pane must FORWARD everything — including a lone
 * Escape — to the embedded agent: inside interactive mewrite, esc = cancel the
 * current turn, and intercepting it made stopping a thinking agent impossible
 * (the pane exit always won). Leaving a live pane is ctrl+w, intercepted one
 * level up in TwoPaneView. Once the agent has exited, esc/q leave the pane.
 * Drives the real PtyPane.handleInput with a fake agent.
 */

import xtermHeadless from "@xterm/headless";
import { setKeybindings, visibleWidth } from "@zhachory1/mewrite-tui";
import { describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../../../core/keybindings.js";
import { initTheme } from "../../theme/theme.js";
import type { LivePtyAgent } from "../pty-agent.js";
import { PtyPane } from "../pty-pane.js";
import type { PtyBuffer } from "../pty-render.js";

const { Terminal } = xtermHeadless;

// Default-binding byte sequences for the pane scrollback keys.
const SHIFT_PAGE_UP = "\x1b[5$";
const SHIFT_PAGE_DOWN = "\x1b[6$";
const SHIFT_END = "\x1b[8$";

// app.agents.scroll* live on the app keybindings, not the bare TUI defaults, so
// the pane's getKeybindings() must resolve the full app config.
setKeybindings(KeybindingsManager.create());
initTheme("dark");

function makePane(exited = false) {
	const writes: string[] = [];
	const agent = {
		exited,
		setRenderCallback: () => {},
		write: (d: string) => writes.push(d),
		resize: () => {},
		markRow: () => null,
		get buffer() {
			return { baseY: 0, getLine: () => undefined };
		},
		cols: 80,
	} as unknown as LivePtyAgent;
	const onBack = vi.fn();
	const pane = new PtyPane(
		"t",
		agent,
		() => {},
		onBack,
		() => 24,
	);
	return { pane, writes, onBack };
}

// While the agent runs, esc must reach it (inside interactive mewrite esc
// cancels the current turn). Leaving a live pane is ctrl+w, handled one level
// up in TwoPaneView — so from the pane's perspective, EVERYTHING forwards.
const FORWARD = {
	"raw ESC": "\x1b",
	"kitty esc 27u": "\x1b[27u",
	"kitty esc press 27;1:1u": "\x1b[27;1:1u",
	"up arrow": "\x1b[A",
	"alt+up": "\x1b\x1b[A",
	char: "a",
	q: "q",
	enter: "\r",
	"ctrl+c": "\x03",
	"F1 (SS3)": "\x1bOP",
	"kitty 'a' 97u": "\x1b[97u",
};

// Once the agent has exited there is nothing to cancel; esc (all encodings)
// and q leave the pane.
const LEAVE_AFTER_EXIT = {
	"raw ESC": "\x1b",
	"kitty 27u": "\x1b[27u",
	"kitty 27;1u": "\x1b[27;1u",
	"kitty press 27;1:1u": "\x1b[27;1:1u",
	"kitty release 27;1:3u": "\x1b[27;1:3u",
	"kitty ctrl 27;5u": "\x1b[27;5u",
	q: "q",
};

describe("PtyPane esc handling", () => {
	for (const [name, data] of Object.entries(FORWARD)) {
		it(`forwards ${name} to a running agent and does not leave`, () => {
			const { pane, writes, onBack } = makePane();
			pane.handleInput(data);
			expect(onBack).not.toHaveBeenCalled();
			expect(writes).toEqual([data]);
		});
	}

	for (const [name, data] of Object.entries(LEAVE_AFTER_EXIT)) {
		it(`leaves the pane on ${name} after the agent has exited`, () => {
			const { pane, writes, onBack } = makePane(true);
			pane.handleInput(data);
			expect(onBack).toHaveBeenCalledOnce();
			expect(writes).toEqual([]);
		});
	}

	it("ignores other keys after the agent has exited (nothing to type into)", () => {
		const { pane, writes, onBack } = makePane(true);
		pane.handleInput("a");
		expect(onBack).not.toHaveBeenCalled();
		expect(writes).toEqual([]);
	});
});

/** PtyPane over a real headless terminal buffer holding `text` at `cols`. */
function paneOverBuffer(text: string, cols: number, rows: number): Promise<PtyPane> {
	const term = new Terminal({ cols, rows, allowProposedApi: true });
	return new Promise((resolve) => {
		term.write(text, () => {
			const agent = {
				exited: false,
				setRenderCallback: () => {},
				write: () => {},
				resize: () => {},
				markRow: (absRow: number) => {
					const b = term.buffer.active;
					return term.registerMarker(absRow - (b.baseY + b.cursorY)) ?? null;
				},
				get buffer() {
					return term.buffer.active as unknown as PtyBuffer;
				},
				cols,
			} as unknown as LivePtyAgent;
			resolve(
				new PtyPane(
					"t",
					agent,
					() => {},
					vi.fn(),
					() => rows + 1,
				),
			);
		});
	});
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_SGR, "");

/**
 * Live pty pane over a real headless terminal. `write(data)` pushes more child
 * output through the emulator (advancing baseY); `grid()` returns the rendered
 * body lines (header stripped). rows = viewport grid height.
 */
function livePane(cols: number, rows: number) {
	const term = new Terminal({ cols, rows, allowProposedApi: true });
	const renders: number[] = [];
	const agent = {
		exited: false,
		exitCode: null,
		setRenderCallback: () => {},
		write: () => {},
		resize: (c: number, r: number) => term.resize(c, r),
		markRow: (absRow: number) => {
			const b = term.buffer.active;
			return term.registerMarker(absRow - (b.baseY + b.cursorY)) ?? null;
		},
		get buffer() {
			return term.buffer.active as unknown as PtyBuffer;
		},
		get cols() {
			return term.cols;
		},
	} as unknown as LivePtyAgent;
	let gridRows = rows;
	const pane = new PtyPane(
		"t",
		agent,
		() => renders.push(1),
		vi.fn(),
		() => gridRows + 1, // + HEADER_ROWS
	);
	const write = (data: string): Promise<void> => new Promise((r) => term.write(data, () => r()));
	const body = (width = cols): string[] => pane.render(width).slice(1).map(stripAnsi);
	const baseY = (): number => term.buffer.active.baseY;
	const setGridRows = (r: number): void => {
		gridRows = r;
	};
	return { pane, write, body, baseY, setGridRows, term };
}

/** N numbered lines "L0".. so rendered content is identifiable per row. */
function numberedLines(n: number): string {
	return Array.from({ length: n }, (_, i) => `L${i}`).join("\r\n");
}

describe("PtyPane scrollback (#227)", () => {
	it("follows the live tail by default and forwards scroll keys' non-effect until scrolled", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(20)); // 0..19, viewport shows the tail
		const tail = p.body();
		expect(tail.some((l) => l.includes("L19"))).toBe(true);
		expect(tail.some((l) => l.includes("L0"))).toBe(false);
	});

	it("scrolls up into history and clamps at the top", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		const up = p.body();
		expect(up.some((l) => l.includes("L19"))).toBe(false); // moved off the tail
		// Page to the very top; further up is clamped (top stays at row 0 = "L0").
		for (let i = 0; i < 20; i++) p.pane.handleInput(SHIFT_PAGE_UP);
		const top = p.body();
		expect(top[0]).toContain("L0");
		const topAgain = (() => {
			p.pane.handleInput(SHIFT_PAGE_UP);
			return p.body();
		})();
		expect(topAgain).toEqual(top);
	});

	it("holds the viewport as new output arrives while paused", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		const held = p.body();
		await p.write(`\r\n${numberedLines(10)}`); // baseY advances
		expect(p.body()).toEqual(held); // marker anchor keeps content pinned
	});

	it("jumps back to the live tail with shift+end", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		expect(p.body().some((l) => l.includes("L29"))).toBe(false);
		p.pane.handleInput(SHIFT_END);
		expect(p.body().some((l) => l.includes("L29"))).toBe(true);
	});

	it("scroll-down past the tail resumes following (clears the anchor)", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		p.pane.handleInput(SHIFT_PAGE_DOWN);
		p.pane.handleInput(SHIFT_PAGE_DOWN); // overshoot the tail
		const atTail = p.body();
		await p.write("\r\nL_new");
		expect(p.body().some((l) => l.includes("L_new"))).toBe(true); // following again
		expect(atTail.some((l) => l.includes("L29"))).toBe(true);
	});

	it("snaps to the tail on resize while paused", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		expect(p.body().some((l) => l.includes("L29"))).toBe(false);
		p.setGridRows(8); // pane height change => reflow => snap to tail
		expect(p.body().some((l) => l.includes("L29"))).toBe(true);
	});

	it("snaps to the tail when the pinned line is evicted past the scrollback cap", async () => {
		const p = livePane(20, 5);
		await p.write(numberedLines(30));
		p.pane.handleInput(SHIFT_PAGE_UP);
		expect(p.body().some((l) => l.includes("L29"))).toBe(false); // paused in history
		// Flood past xterm's default 1000-line scrollback so the pinned row is trimmed.
		await p.write(`\r\n${numberedLines(1200)}`);
		const after = p.body();
		expect(after.some((l) => l.includes("L2"))).toBe(false); // old history gone
		expect(after.some((l) => l.includes("L1199"))).toBe(true); // following the live tail
	});

	it("forwards bare pageUp/pageDown to a running child (not stolen by scrollback)", () => {
		const { pane, writes } = makePane();
		pane.handleInput("\x1b[5~"); // bare pageUp
		pane.handleInput("\x1b[6~"); // bare pageDown
		expect(writes).toEqual(["\x1b[5~", "\x1b[6~"]);
	});

	it("consumes scroll keys instead of forwarding them to the child", () => {
		const { pane, writes } = makePane();
		pane.handleInput(SHIFT_PAGE_UP);
		pane.handleInput(SHIFT_PAGE_DOWN);
		pane.handleInput(SHIFT_END);
		expect(writes).toEqual([]);
	});
});

describe("PtyPane render width", () => {
	// The embedded @xterm/headless emulator (Unicode v6) measures `✅` as width 1,
	// but the TUI's visibleWidth() (RGI emoji) measures it as 2. A grid line that
	// fills the child's columns must still be clamped to the pane width, or the
	// outer renderer throws "exceeds terminal width".
	it("clamps emoji-bearing grid lines to the pane width", async () => {
		const width = 20;
		// Emoji + enough content to fill the row past `width` under visibleWidth.
		const pane = await paneOverBuffer(`✅${"x".repeat(width)}`, width, 3);
		for (const line of pane.render(width)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
