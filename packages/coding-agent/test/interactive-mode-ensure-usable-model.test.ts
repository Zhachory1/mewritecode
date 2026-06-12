import type { Model } from "@juliusbrussee/caveman-ai";
import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";

// findInitialModel is async and reads modelRegistry; we drive it through a fake
// registry whose getAvailable()/find() return what each scenario needs.

const fakeModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude" } as unknown as Model<string>;

function makeFakeThis(opts: {
	currentModel?: Model<string>;
	hasConfiguredAuth?: boolean;
	available?: Model<string>[];
	isTTY?: boolean;
}) {
	const setModel = vi.fn(async () => {});
	const showOAuthSelector = vi.fn(async () => {});
	const showWarning = vi.fn();
	const registry = {
		hasConfiguredAuth: vi.fn(() => opts.hasConfiguredAuth ?? false),
		refresh: vi.fn(),
		getAvailable: vi.fn(() => opts.available ?? []),
		find: vi.fn(() => undefined),
	};
	const fakeThis: any = {
		session: { model: opts.currentModel, modelRegistry: registry, setModel },
		ui: { terminal: { isTTY: () => opts.isTTY ?? true } },
		showWarning,
		showOAuthSelector,
		// clearKeylessHint / showKeylessHint are real prototype methods that call
		// showWarning; bind them so they resolve `this`.
		clearKeylessHint: (InteractiveMode as any).prototype.clearKeylessHint,
		showKeylessHint: (InteractiveMode as any).prototype.showKeylessHint,
		pendingPrompt: undefined,
	};
	return { fakeThis, setModel, showOAuthSelector, showWarning, registry };
}

const call = (fakeThis: any, opts?: { pending?: string; forceReauth?: boolean }) =>
	(InteractiveMode as any).prototype.ensureUsableModel.call(fakeThis, opts);

describe("InteractiveMode.ensureUsableModel", () => {
	test("returns true when the current model already has configured auth", async () => {
		const { fakeThis, showOAuthSelector } = makeFakeThis({
			currentModel: fakeModel,
			hasConfiguredAuth: true,
		});
		await expect(call(fakeThis)).resolves.toBe(true);
		expect(showOAuthSelector).not.toHaveBeenCalled();
	});

	test("resolves and sets a usable model when one is available, returns true", async () => {
		const { fakeThis, setModel, showOAuthSelector } = makeFakeThis({
			currentModel: undefined,
			available: [fakeModel],
		});
		await expect(call(fakeThis)).resolves.toBe(true);
		expect(setModel).toHaveBeenCalledWith(fakeModel);
		expect(showOAuthSelector).not.toHaveBeenCalled();
	});

	test("on TTY with no usable model: stashes pending, shows hint, opens selector, returns false", async () => {
		const { fakeThis, showOAuthSelector, showWarning } = makeFakeThis({
			available: [],
			isTTY: true,
		});
		await expect(call(fakeThis, { pending: "do the thing" })).resolves.toBe(false);
		expect(fakeThis.pendingPrompt).toBe("do the thing");
		expect(showWarning).toHaveBeenCalled();
		expect(showOAuthSelector).toHaveBeenCalledWith("login");
	});

	test("non-TTY with no usable model returns false without opening the selector", async () => {
		const { fakeThis, showOAuthSelector } = makeFakeThis({
			available: [],
			isTTY: false,
		});
		await expect(call(fakeThis, { pending: "x" })).resolves.toBe(false);
		expect(showOAuthSelector).not.toHaveBeenCalled();
	});

	// Regression (impl-council R1): a stored-but-EXPIRED OAuth token reports
	// hasConfiguredAuth=true (presence-only). Without forceReauth the gate would
	// no-op → the call-time throw loops forever. forceReauth must bypass the
	// presence guard and open re-login even though a model is "configured".
	test("forceReauth opens re-login even when current model reports configured auth", async () => {
		const { fakeThis, setModel, showOAuthSelector } = makeFakeThis({
			currentModel: fakeModel,
			hasConfiguredAuth: true, // stale token still present
			isTTY: true,
		});
		await expect(call(fakeThis, { pending: "retry me", forceReauth: true })).resolves.toBe(false);
		expect(setModel).not.toHaveBeenCalled();
		expect(showOAuthSelector).toHaveBeenCalledWith("login");
		expect(fakeThis.pendingPrompt).toBe("retry me");
	});

	test("forceReauth on non-TTY returns false without opening the selector", async () => {
		const { fakeThis, showOAuthSelector } = makeFakeThis({
			currentModel: fakeModel,
			hasConfiguredAuth: true,
			isTTY: false,
		});
		await expect(call(fakeThis, { forceReauth: true })).resolves.toBe(false);
		expect(showOAuthSelector).not.toHaveBeenCalled();
	});
});
