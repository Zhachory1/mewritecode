/**
 * Issue #17 HIGH 2 — bash render interval leak.
 *
 * The bash result renderer starts a 1s `setInterval` while the result is still
 * partial (to tick the live elapsed-time display). It is only cleared on the
 * next *non-partial* render. If the row unmounts mid-partial (abort, `/clear`,
 * session swap), that render never arrives and the interval leaks forever,
 * firing `invalidate()` against a detached component.
 *
 * `disposeRender(state)` must clear the interval on unmount. This test asserts
 * the interval is live after a partial render and cleared after `disposeRender`.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

beforeAll(() => {
	initTheme(undefined, false);
});

afterEach(() => {
	vi.useRealTimers();
});

function partialRenderContext(state: any) {
	// `renderCall` sets startedAt once execution begins; pre-seed it so the
	// renderResult elapsed-time interval condition (startedAt !== undefined)
	// holds without driving the full call→result render sequence.
	state.startedAt ??= Date.now();
	return {
		args: { command: "sleep 100" },
		toolCallId: "call-1",
		invalidate: () => {},
		lastComponent: undefined,
		state,
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: true,
		expanded: false,
		showImages: false,
		isError: false,
	} as any;
}

const partialResult = {
	content: [{ type: "text" as const, text: "running..." }],
	details: undefined,
} as any;

describe("bash renderResult interval lifecycle (issue #17)", () => {
	it("starts an elapsed-time interval during a partial render", () => {
		const tool = createBashToolDefinition(process.cwd());
		const state: any = {};

		tool.renderResult?.(partialResult, { expanded: false, isPartial: true }, {} as any, partialRenderContext(state));

		expect(state.interval).toBeDefined();
	});

	it("disposeRender clears the interval when the row unmounts mid-partial", () => {
		const clearSpy = vi.spyOn(globalThis, "clearInterval");

		const tool = createBashToolDefinition(process.cwd());
		const state: any = {};

		// Partial render → interval armed (the leak source).
		tool.renderResult?.(partialResult, { expanded: false, isPartial: true }, {} as any, partialRenderContext(state));
		const armed = state.interval;
		expect(armed).toBeDefined();

		// Row unmounts before any non-partial render arrives.
		expect(tool.disposeRender).toBeDefined();
		tool.disposeRender?.(state);

		expect(clearSpy).toHaveBeenCalledWith(armed);
		expect(state.interval).toBeUndefined();

		clearSpy.mockRestore();
	});

	it("disposeRender is a no-op when no interval was armed", () => {
		const tool = createBashToolDefinition(process.cwd());
		const state: any = { interval: undefined };
		expect(() => tool.disposeRender?.(state)).not.toThrow();
	});
});
