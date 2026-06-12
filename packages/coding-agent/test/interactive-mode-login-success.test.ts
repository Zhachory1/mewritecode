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
});
