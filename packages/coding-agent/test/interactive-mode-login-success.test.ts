import type { Model } from "@juliusbrussee/caveman-ai";
import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";

const fakeModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude" } as unknown as Model<string>;

function makeFakeThis(opts: { available?: Model<string>[]; pendingPrompt?: string }) {
	const prompt = vi.fn(async () => {});
	const setModel = vi.fn(async () => {});
	const showOAuthSelector = vi.fn(async () => {});
	const showWarning = vi.fn();
	const showError = vi.fn();
	const updateAvailableProviderCount = vi.fn(async () => {});
	const registry = {
		hasConfiguredAuth: vi.fn(() => false),
		refresh: vi.fn(),
		getAvailable: vi.fn(() => opts.available ?? []),
		find: vi.fn(() => undefined),
	};
	const fakeThis: any = {
		session: { model: undefined, modelRegistry: registry, setModel, prompt },
		ui: { terminal: { isTTY: () => true } },
		showWarning,
		showError,
		showOAuthSelector,
		updateAvailableProviderCount,
		clearKeylessHint: (InteractiveMode as any).prototype.clearKeylessHint,
		showKeylessHint: (InteractiveMode as any).prototype.showKeylessHint,
		ensureUsableModel: (InteractiveMode as any).prototype.ensureUsableModel,
		pendingPrompt: opts.pendingPrompt,
	};
	return { fakeThis, prompt, setModel, showOAuthSelector, registry, updateAvailableProviderCount };
}

const call = (fakeThis: any) => (InteractiveMode as any).prototype.onLoginSuccess.call(fakeThis);

describe("InteractiveMode.onLoginSuccess", () => {
	test("refreshes, updates provider count, selects a model when one is now available", async () => {
		const { fakeThis, setModel, registry, updateAvailableProviderCount } = makeFakeThis({
			available: [fakeModel],
		});
		await call(fakeThis);
		expect(registry.refresh).toHaveBeenCalled();
		expect(updateAvailableProviderCount).toHaveBeenCalled();
		expect(setModel).toHaveBeenCalledWith(fakeModel);
	});

	test("replays the pending prompt once when a model becomes usable", async () => {
		const { fakeThis, prompt } = makeFakeThis({
			available: [fakeModel],
			pendingPrompt: "do the thing",
		});
		await call(fakeThis);
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt).toHaveBeenCalledWith("do the thing");
		expect(fakeThis.pendingPrompt).toBeUndefined();
	});

	test("does NOT run the pending prompt and re-opens the selector when no model resolves", async () => {
		const { fakeThis, prompt, showOAuthSelector } = makeFakeThis({
			available: [],
			pendingPrompt: "do the thing",
		});
		await call(fakeThis);
		expect(prompt).not.toHaveBeenCalled();
		expect(showOAuthSelector).toHaveBeenCalledWith("login");
		expect(fakeThis.pendingPrompt).toBe("do the thing");
	});

	// Task-first no-auth round-trip: a keyless user submits a task → the gate
	// stashes it and opens the selector (no prompt run) → login completes →
	// onLoginSuccess replays exactly that task once. This binds the stash half
	// (ensureUsableModel) to the replay half (onLoginSuccess) as one data path.
	test("stashes a task-first prompt then replays it once after login", async () => {
		// Start keyless: no available model so the gate stashes + opens selector.
		const { fakeThis, prompt, setModel, showOAuthSelector } = makeFakeThis({ available: [] });
		fakeThis.ensureUsableModel = (InteractiveMode as any).prototype.ensureUsableModel;
		fakeThis.clearKeylessHint = (InteractiveMode as any).prototype.clearKeylessHint;
		fakeThis.showKeylessHint = (InteractiveMode as any).prototype.showKeylessHint;

		const stashed = await (InteractiveMode as any).prototype.ensureUsableModel.call(fakeThis, {
			pending: "do the task first",
		});
		expect(stashed).toBe(false);
		expect(prompt).not.toHaveBeenCalled();
		expect(showOAuthSelector).toHaveBeenCalledWith("login");
		expect(fakeThis.pendingPrompt).toBe("do the task first");

		// Login completes: a model is now available → replay the stashed task once.
		fakeThis.session.modelRegistry.getAvailable = vi.fn(() => [fakeModel]);
		await call(fakeThis);
		expect(setModel).toHaveBeenCalledWith(fakeModel);
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt).toHaveBeenCalledWith("do the task first");
		expect(fakeThis.pendingPrompt).toBeUndefined();
	});
});
