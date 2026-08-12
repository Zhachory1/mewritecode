/**
 * The pty pane must treat a lone Escape as "leave the pane" and NEVER forward it
 * to the embedded agent — inside interactive mewrite, esc = abort the turn, so a
 * leaked esc reads as "escape stopped my agent". Arrows/alt/other keys must still
 * reach the agent. Drives the real PtyPane.handleInput with a fake agent.
 */

import { describe, expect, it, vi } from "vitest";
import type { LivePtyAgent } from "../pty-agent.js";
import { PtyPane } from "../pty-pane.js";

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

const LEAVE = {
	"raw ESC": "\x1b",
	"kitty 27u": "\x1b[27u",
	"kitty 27;1u": "\x1b[27;1u",
	"kitty press 27;1:1u": "\x1b[27;1:1u",
	"kitty release 27;1:3u": "\x1b[27;1:3u",
	"kitty ctrl 27;5u": "\x1b[27;5u",
};

const FORWARD = {
	"up arrow": "\x1b[A",
	"alt+up": "\x1b\x1b[A",
	char: "a",
	enter: "\r",
	"ctrl+c": "\x03",
	"F1 (SS3)": "\x1bOP",
	"kitty 'a' 97u": "\x1b[97u",
};

describe("PtyPane esc handling", () => {
	for (const [name, data] of Object.entries(LEAVE)) {
		it(`leaves the pane on ${name} and does not forward it`, () => {
			const { pane, writes, onBack } = makePane();
			pane.handleInput(data);
			expect(onBack).toHaveBeenCalledOnce();
			expect(writes).toEqual([]);
		});
	}

	for (const [name, data] of Object.entries(FORWARD)) {
		it(`forwards ${name} to the agent and does not leave`, () => {
			const { pane, writes, onBack } = makePane();
			pane.handleInput(data);
			expect(onBack).not.toHaveBeenCalled();
			expect(writes).toEqual([data]);
		});
	}

	it("still leaves on esc after the agent has exited", () => {
		const { pane, writes, onBack } = makePane(true);
		pane.handleInput("\x1b");
		expect(onBack).toHaveBeenCalledOnce();
		expect(writes).toEqual([]);
	});
});
