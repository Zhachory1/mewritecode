/**
 * WS15: Registry merger — convert RegistryProvider entries into the
 * @zhachory1/mewrite-ai Model<Api> shape so they can be injected into ModelRegistry.
 *
 * Compatibility constraint: existing model-registry.ts consumers keep
 * working. The merger produces models in the same shape as getModels()
 * outputs — existing code paths are unchanged.
 */

import type { Api, Model } from "../types.js";
import type { Registry, RegistryModel, RegistryProvider } from "./schema.js";

// ---------------------------------------------------------------------------
// Kind → Api mapping
// ---------------------------------------------------------------------------

/** Map registry provider kinds to the @zhachory1/mewrite-ai Api string */
function kindToApi(kind: RegistryProvider["kind"]): Api | undefined {
	switch (kind) {
		case "anthropic":
			return "anthropic";
		case "openai":
			return "openai-responses";
		case "google":
			return "google";
		case "openrouter":
			return "openai-completions";
		case "mistral":
			return "openai-completions";
		case "bedrock":
			return "bedrock-converse-stream";
		case "gemini-cli":
			return "google";
		case "vertex":
			return "google-vertex";
		case "xai":
			return "openai-completions";
		case "groq":
			return "openai-completions";
		case "cerebras":
			return "openai-completions";
		case "other":
			return "openai-completions";
		default:
			return undefined;
	}
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Convert a single RegistryModel + its parent RegistryProvider into
 * the Model<Api> shape used by @zhachory1/mewrite-ai's internal registry.
 */
export function registryModelToModel(provider: RegistryProvider, model: RegistryModel): Model<Api> | undefined {
	const api = kindToApi(provider.kind);
	if (!api) return undefined;

	const caps = model.capabilities ?? [];

	return {
		id: model.id,
		name: model.displayName,
		api,
		provider: provider.id,
		baseUrl: provider.baseUrl ?? "",
		reasoning: caps.includes("reasoning"),
		input: caps.includes("vision") ? ["text", "image"] : ["text"],
		cost: {
			input: model.inputCostPerMtok ?? 0,
			output: model.outputCostPerMtok ?? 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: model.contextWindow,
		maxTokens: model.maxOutputTokens ?? 16384,
		headers: undefined,
		compat: undefined,
	} as Model<Api>;
}

/**
 * Convert all models from a Registry into Model<Api>[] entries.
 * Unknown provider kinds are silently skipped.
 */
export function registryToModels(registry: Registry): Model<Api>[] {
	const result: Model<Api>[] = [];
	for (const provider of registry.providers) {
		for (const model of provider.models) {
			const m = registryModelToModel(provider, model);
			if (m) result.push(m);
		}
	}
	return result;
}
