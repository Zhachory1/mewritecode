#!/usr/bin/env tsx

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "../src/models.generated.js";
import { type Registry, type RegistryModel, validateRegistry } from "../src/registry/schema.js";
import type { Api, Model } from "../src/types.js";
import { type AllowlistProvider, REGISTRY_ALLOWLIST } from "./registry-allowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const registryPath = join(__dirname, "..", "..", "..", "registry", "registry.json");

const MODELS_BY_PROVIDER = MODELS as unknown as Record<string, Record<string, Model<Api>>>;

function capabilities(model: Model<Api>): RegistryModel["capabilities"] {
	const caps: NonNullable<RegistryModel["capabilities"]> = ["tools"];
	if (model.input.includes("image")) caps.push("vision");
	if (model.cost.cacheRead > 0 || model.cost.cacheWrite > 0) caps.push("cache");
	if (model.reasoning) caps.push("reasoning");
	return caps;
}

function projectModel(providerId: string, source: AllowlistProvider, modelId: string): RegistryModel {
	const sourceModels = MODELS_BY_PROVIDER[source.source];
	if (!sourceModels) {
		throw new Error(`Provider "${providerId}": MODELS has no source provider "${source.source}"`);
	}
	const model = sourceModels[modelId];
	if (!model) {
		throw new Error(
			`Provider "${providerId}": model "${modelId}" not found in MODELS["${source.source}"] ` +
				`(id renamed or dropped upstream — update scripts/registry-allowlist.ts)`,
		);
	}
	return {
		id: model.id,
		displayName: model.name,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxTokens,
		inputCostPerMtok: model.cost.input,
		outputCostPerMtok: model.cost.output,
		capabilities: capabilities(model),
	};
}

/**
 * Build a Registry from the curated allowlist projected onto MODELS.
 * `publishedAt` is the freshness signal; `version` is intentionally static.
 * Throws if any allowlisted id is missing or a provider yields zero models.
 */
export function buildRegistry(publishedAt: string): Registry {
	const providers = Object.entries(REGISTRY_ALLOWLIST).map(([id, spec]) => {
		const models = spec.models.map((modelId) => projectModel(id, spec, modelId));
		if (models.length === 0) {
			throw new Error(`Provider "${id}" projected to zero models`);
		}
		return {
			id,
			name: spec.name,
			kind: spec.kind,
			...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
			auth: spec.auth,
			models,
		};
	});

	return { version: "1.0.0", channel: "stable" as const, publishedAt, providers };
}

function main(): void {
	const registry = buildRegistry(new Date().toISOString());

	const result = validateRegistry(registry);
	if (!result.ok) {
		console.error("Generated registry failed schema validation:");
		console.error(result.errors.join("\n"));
		process.exit(1);
	}

	writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
	const modelCount = registry.providers.reduce((sum, p) => sum + p.models.length, 0);
	console.log(`Wrote ${registryPath}: ${registry.providers.length} providers, ${modelCount} models`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
