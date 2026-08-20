/**
 * While the agent runs, the pty pane must FORWARD everything — including a lone
 * Escape — to the embedded agent: inside interactive mewrite, esc = cancel the
 * current turn, and intercepting it made stopping a thinking agent impossible
 * (the pane exit always won). Leaving a live pane is ctrl+w, intercepted one
 * level up in TwoPaneView. Once the agent has exited, esc/q leave the pane.
 * Drives the real PtyPane.handleInput with a fake agent.
 */

import xtermHeadless from "@xterm/headless";
import { visibleWidth } from "@zhachory1/mewrite-tui";
import { describe, expect, it, vi } from "vitest";
import { initTheme } from "../../theme/theme.js";
import type { LivePtyAgent } from "../pty-agent.js";
import { PtyPane } from "../pty-pane.js";
import type { PtyBuffer } from "../pty-render.js";

const { Terminal } = xtermHeadless;

initTheme("dark");

function makePane(exited = false) {
	const writes: string[] = [];
	const agent = {
		exited,
		setRenderCallback: () => {},
		write: (d: string) => writes.push(d),
		resize: () => {},
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
