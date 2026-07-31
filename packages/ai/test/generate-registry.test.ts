import { describe, expect, it } from "vitest";
import { buildRegistry } from "../scripts/generate-registry.js";
import { REGISTRY_ALLOWLIST } from "../scripts/registry-allowlist.js";
import { validateRegistry } from "../src/registry/schema.js";

describe("buildRegistry", () => {
	it("produces a schema-valid registry from the allowlist", () => {
		const registry = buildRegistry("2026-01-01T00:00:00.000Z");
		const result = validateRegistry(registry);
		expect(result.ok).toBe(true);
	});

	it("uses the provided publishedAt and static version", () => {
		const registry = buildRegistry("2026-01-01T00:00:00.000Z");
		expect(registry.publishedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(registry.version).toBe("1.0.0");
		expect(registry.channel).toBe("stable");
	});

	it("projects every allowlisted provider and model", () => {
		const registry = buildRegistry("2026-01-01T00:00:00.000Z");
		expect(registry.providers).toHaveLength(Object.keys(REGISTRY_ALLOWLIST).length);
		for (const provider of registry.providers) {
			const spec = REGISTRY_ALLOWLIST[provider.id];
			expect(spec).toBeDefined();
			expect(provider.models.map((m) => m.id)).toEqual(spec.models);
			expect(provider.models.length).toBeGreaterThan(0);
		}
	});

	it("derives pricing and tools capability for every model", () => {
		const registry = buildRegistry("2026-01-01T00:00:00.000Z");
		for (const provider of registry.providers) {
			for (const model of provider.models) {
				expect(model.inputCostPerMtok).toBeTypeOf("number");
				expect(model.outputCostPerMtok).toBeTypeOf("number");
				expect(model.capabilities).toContain("tools");
			}
		}
	});
});
