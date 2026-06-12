import { afterEach, describe, expect, it } from "vitest";
import { NoUsableAuthError } from "../../src/core/errors.js";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession keyless throws NoUsableAuthError", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("throws NoUsableAuthError with reason 'no-model' when no model is selected", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		// Force the no-model state.
		(harness.session.agent.state as { model?: unknown }).model = undefined;

		await expect(harness.session.prompt("hi")).rejects.toBeInstanceOf(NoUsableAuthError);
		await expect(harness.session.prompt("hi")).rejects.toMatchObject({ reason: "no-model" });
	});

	it("throws NoUsableAuthError with reason 'no-key' when the model has no configured auth", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);

		await expect(harness.session.prompt("hi")).rejects.toBeInstanceOf(NoUsableAuthError);
		await expect(harness.session.prompt("hi")).rejects.toMatchObject({ reason: "no-key" });
	});

	it("NoUsableAuthError is a subclass of Error (generic catchers unaffected)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session.agent.state as { model?: unknown }).model = undefined;

		await expect(harness.session.prompt("hi")).rejects.toBeInstanceOf(Error);
	});
});
