/**
 * Unit tests for subagent model tiers (fast/normal/strong).
 *
 * Tiers resolve to a concrete model within one provider via the curated
 * MODEL_TIERS map (pinned, not a cost heuristic). parseTier gates on the
 * `tier:` sigil so tier keywords never collide with concrete model ids.
 */
import { describe, expect, it } from "vitest";
import { MODEL_TIERS, parseTier, resolveTier } from "../src/model-tiers.js";
import type { Api, Model, Provider } from "../src/types.js";

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

describe("parseTier", () => {
	it("parses sigil-prefixed tier keywords", () => {
		expect(parseTier("tier:fast")).toBe("fast");
		expect(parseTier("tier:normal")).toBe("normal");
		expect(parseTier("tier:strong")).toBe("strong");
	});

	it("rejects bare keywords (no sigil) so they stay concrete ids", () => {
		expect(parseTier("fast")).toBeUndefined();
		expect(parseTier("strong")).toBeUndefined();
	});

	it("rejects junk and undefined", () => {
		expect(parseTier("tier:medium")).toBeUndefined();
		expect(parseTier("tier:")).toBeUndefined();
		expect(parseTier("claude-sonnet-5")).toBeUndefined();
		expect(parseTier(undefined)).toBeUndefined();
	});
});

describe("resolveTier", () => {
	const anthropicPool = [
		model("anthropic", "claude-haiku-4-5"),
		model("anthropic", "claude-sonnet-5"),
		model("anthropic", "claude-opus-4-8"),
	];

	it("resolves each tier to its curated model", () => {
		expect(resolveTier("fast", "anthropic", anthropicPool)?.id).toBe("claude-haiku-4-5");
		expect(resolveTier("normal", "anthropic", anthropicPool)?.id).toBe("claude-sonnet-5");
		expect(resolveTier("strong", "anthropic", anthropicPool)?.id).toBe("claude-opus-4-8");
	});

	it("only considers models of the requested provider", () => {
		const mixed = [...anthropicPool, model("openai", "claude-sonnet-5")];
		const picked = resolveTier("normal", "anthropic", mixed);
		expect(picked?.provider).toBe("anthropic");
		expect(picked?.id).toBe("claude-sonnet-5");
	});

	it("returns undefined when the curated id is not in the authed pool", () => {
		// strong wants claude-opus-4-8; pool lacks it.
		const pool = [model("anthropic", "claude-haiku-4-5"), model("anthropic", "claude-sonnet-5")];
		expect(resolveTier("strong", "anthropic", pool)).toBeUndefined();
	});

	it("returns undefined for an uncurated provider (no MODEL_TIERS row)", () => {
		const pool = [model("openrouter", "anything")];
		expect(resolveTier("fast", "openrouter", pool)).toBeUndefined();
	});

	it("returns undefined for an empty pool", () => {
		expect(resolveTier("fast", "anthropic", [])).toBeUndefined();
	});

	it("resolves a curated alias id to a dated authed variant", () => {
		// Registry ships dated ids; curated map uses the alias. Alias must match.
		const pool = [model("anthropic", "claude-sonnet-5-20260115")];
		expect(resolveTier("normal", "anthropic", pool)?.id).toBe("claude-sonnet-5-20260115");
	});

	it("openai-codex resolves the gpt-5.6 family", () => {
		const pool = [
			model("openai-codex", "gpt-5.6-luna"),
			model("openai-codex", "gpt-5.6-terra"),
			model("openai-codex", "gpt-5.6-sol"),
		];
		expect(resolveTier("fast", "openai-codex", pool)?.id).toBe("gpt-5.6-luna");
		expect(resolveTier("strong", "openai-codex", pool)?.id).toBe("gpt-5.6-sol");
	});
});

describe("MODEL_TIERS map", () => {
	it("curates the authed providers plus majors, omits routers", () => {
		expect(MODEL_TIERS.anthropic).toBeDefined();
		expect(MODEL_TIERS["openai-codex"]).toBeDefined();
		expect(MODEL_TIERS.openai).toBeDefined();
		// Routers intentionally omitted → warn + parent model at the call site.
		expect(MODEL_TIERS.openrouter).toBeUndefined();
		expect(MODEL_TIERS["vercel-ai-gateway"]).toBeUndefined();
	});

	it("every curated row has all three tiers", () => {
		for (const row of Object.values(MODEL_TIERS)) {
			expect(row).toMatchObject({
				fast: expect.any(String),
				normal: expect.any(String),
				strong: expect.any(String),
			});
		}
	});
});
