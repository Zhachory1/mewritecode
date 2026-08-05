/**
 * Unit tests for resolveSubagentModelRef — the pure model-ref resolver used by
 * the subagent spawn `resolveModel` callback. Covers the tier fallback ladder
 * (curated tier -> curated normal -> parent + warning) and the unchanged
 * concrete-id / no-model paths.
 */
import type { Api, Model, Provider } from "@zhachory1/mewrite-ai";
import { describe, expect, it } from "vitest";
import { resolveSubagentModelRef } from "../src/core/agent-session.js";

function model(provider: Provider, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "anthropic-messages" as Api,
		provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	} as Model<Api>;
}

const parent = model("anthropic", "claude-opus-4-8");
const anthropicPool = [
	model("anthropic", "claude-haiku-4-5"),
	model("anthropic", "claude-sonnet-5"),
	model("anthropic", "claude-opus-4-8"),
];

describe("resolveSubagentModelRef — tiers", () => {
	it("resolves a tier to the curated model for the parent's provider", () => {
		expect(resolveSubagentModelRef("tier:fast", parent, anthropicPool).ref).toBe("anthropic/claude-haiku-4-5");
		expect(resolveSubagentModelRef("tier:normal", parent, anthropicPool).ref).toBe("anthropic/claude-sonnet-5");
		expect(resolveSubagentModelRef("tier:strong", parent, anthropicPool).ref).toBe("anthropic/claude-opus-4-8");
	});

	it("falls back to curated normal when the requested tier is not authed", () => {
		// strong wants claude-opus-4-8; drop it so only fast+normal remain.
		const pool = [model("anthropic", "claude-haiku-4-5"), model("anthropic", "claude-sonnet-5")];
		const { ref, warning } = resolveSubagentModelRef("tier:strong", parent, pool);
		expect(ref).toBe("anthropic/claude-sonnet-5");
		expect(warning).toBeUndefined();
	});

	it("falls back to parent model + warning when neither tier nor normal resolve", () => {
		// Curated ids for anthropic present in map, but none authed.
		const pool = [model("anthropic", "some-unlisted-model")];
		const { ref, warning } = resolveSubagentModelRef("tier:fast", parent, pool);
		expect(ref).toBe("anthropic/claude-opus-4-8"); // parent
		expect(warning).toContain("tier:fast");
	});

	it("never returns the user's default model on tier failure (uses parent)", () => {
		// Uncurated provider → no tier row → parent, not any global default.
		const p = model("openrouter", "openai/gpt-5.1-codex");
		const { ref, warning } = resolveSubagentModelRef("tier:fast", p, [p]);
		expect(ref).toBe("openrouter/openai/gpt-5.1-codex");
		expect(warning).toContain("openrouter");
	});
});

describe("resolveSubagentModelRef — unchanged paths (regression)", () => {
	it("no requested model → parent ref", () => {
		expect(resolveSubagentModelRef(undefined, parent, anthropicPool).ref).toBe("anthropic/claude-opus-4-8");
	});

	it("concrete provider/id match", () => {
		expect(resolveSubagentModelRef("anthropic/claude-haiku-4-5", parent, anthropicPool).ref).toBe(
			"anthropic/claude-haiku-4-5",
		);
	});

	it("concrete bare-id match", () => {
		expect(resolveSubagentModelRef("claude-sonnet-5", parent, anthropicPool).ref).toBe("anthropic/claude-sonnet-5");
	});

	it("unknown concrete id → parent ref", () => {
		expect(resolveSubagentModelRef("no-such-model", parent, anthropicPool).ref).toBe("anthropic/claude-opus-4-8");
	});

	it("no parent model + no request → undefined ref", () => {
		expect(resolveSubagentModelRef(undefined, undefined, anthropicPool).ref).toBeUndefined();
	});
});
