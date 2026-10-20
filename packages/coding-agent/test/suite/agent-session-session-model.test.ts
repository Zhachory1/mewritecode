import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession session-only model switch", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("records the model in the session without changing saved defaults", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: false },
			],
			settings: { defaultProvider: "keep", defaultModel: "keep-model", defaultThinkingLevel: "high" },
		});
		harnesses.push(harness);
		harness.session.setThinkingLevel("high");

		await harness.session.setModel(harness.getModel("faux-2")!, false);

		expect(harness.session.model?.id).toBe("faux-2");
		expect(harness.session.thinkingLevel).toBe("off");
		expect(harness.settingsManager.getDefaultProvider()).toBe("keep");
		expect(harness.settingsManager.getDefaultModel()).toBe("keep-model");
		expect(harness.settingsManager.getDefaultThinkingLevel()).toBe("high");
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "model_change")).toHaveLength(1);
	});
});
