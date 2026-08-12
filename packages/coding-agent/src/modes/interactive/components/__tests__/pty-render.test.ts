/**
 * The cell→SGR renderer is the riskiest half of the PTY live-pane feature: it
 * rebuilds ANSI styling from `@xterm/headless` buffer cells (no serialize addon).
 * Drive a real headless terminal so the tests exercise the actual cell API.
 */

import xtermHeadless from "@xterm/headless";
import { describe, expect, it } from "vitest";

const { Terminal } = xtermHeadless;

import type { PtyBuffer } from "../pty-render.js";
import { renderBuffer, renderLine } from "../pty-render.js";

/** Write text to a fresh headless terminal and return its active buffer. */
function bufferFor(text: string, cols = 40, rows = 4): Promise<PtyBuffer> {
	const term = new Terminal({ cols, rows, allowProposedApi: true });
	return new Promise((resolve) => {
		// xterm's write is async; wait for the flush callback so cells are populated.
		term.write(text, () => resolve(term.buffer.active as unknown as PtyBuffer));
	});
}

const line0 = async (text: string, cols?: number): Promise<string> =>
	renderLine((await bufferFor(text, cols)).getLine(0), cols ?? 40);

describe("renderLine", () => {
	it("renders plain text with no styling and trims trailing blanks", async () => {
		expect(await line0("hello")).toBe("hello");
	});

	it("wraps a 16-color run in bold + palette SGR with reset", async () => {
		// xterm normalizes 16-color (31) to palette index (38;5;1); renders identically.
		expect(await line0("\x1b[1;31mB\x1b[0m")).toBe("\x1b[1;38;5;1mB\x1b[0m");
	});

	it("renders 256-color foreground", async () => {
		expect(await line0("\x1b[38;5;208mP\x1b[0m")).toBe("\x1b[38;5;208mP\x1b[0m");
	});

	it("renders truecolor foreground", async () => {
		expect(await line0("\x1b[38;2;10;20;30mR\x1b[0m")).toBe("\x1b[38;2;10;20;30mR\x1b[0m");
	});

	it("renders underline + green together", async () => {
		expect(await line0("\x1b[4;32mU\x1b[0m")).toBe("\x1b[4;38;5;2mU\x1b[0m");
	});

	it("coalesces adjacent same-style cells into one run", async () => {
		expect(await line0("\x1b[31mabc\x1b[0m")).toBe("\x1b[38;5;1mabc\x1b[0m");
	});

	it("keeps default-styled trailing content after a styled run", async () => {
		// styled "A" then plain " ok" — the plain part must survive.
		expect(await line0("\x1b[31mA\x1b[0m ok")).toBe("\x1b[38;5;1mA\x1b[0m ok");
	});

	it("preserves a wide character and drops its spacer cell", async () => {
		expect(await line0("a世b")).toBe("a世b");
	});

	it("returns empty string for a blank line", async () => {
		expect(await line0("")).toBe("");
	});

	it("keeps a background-colored space (not treated as trailing blank)", async () => {
		const out = await line0("\x1b[41m \x1b[0m");
		expect(out).toContain("48;5;1");
		expect(out.endsWith("\x1b[0m")).toBe(true);
	});
});

describe("renderBuffer scroll tracking", () => {
	it("renders the live viewport after the terminal scrolls, not the top of scrollback", async () => {
		// Write 12 lines into a 5-row terminal so it scrolls; the visible window must
		// be the last 5 lines (L8..L12), not the first 5 (L1..L5).
		const buf = await bufferFor("L1\r\nL2\r\nL3\r\nL4\r\nL5\r\nL6\r\nL7\r\nL8\r\nL9\r\nL10\r\nL11\r\nL12", 20, 5);
		const lines = renderBuffer(buf, 5, 20);
		expect(lines).toEqual(["L8", "L9", "L10", "L11", "L12"]);
	});
});
