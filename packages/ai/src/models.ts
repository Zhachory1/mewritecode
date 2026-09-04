import { MODELS } from "./models.generated.js";
import { getAnthropicCapabilities } from "./providers/anthropic-capabilities.js";
import { _setRegistryHook, _setRegistryReplaceHook } from "./providers/anthropic-discovery.js";
import type { Api, KnownProvider, Model, Usage } from "./types.js";

const DIGITALOCEAN_MODELS = {
	"openai-gpt-4.1": {
		id: "openai-gpt-4.1",
		name: "GPT-4.1 (DigitalOcean)",
		api: "openai-completions",
		provider: "digitalocean",
		baseUrl: "https://inference.do-ai.run/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	} satisfies Model<"openai-completions">,
} as const;

const BUILT_IN_MODELS = { ...MODELS, digitalocean: DIGITALOCEAN_MODELS } as const;

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();
const discoveredModelIds = new Map<string, Set<string>>();

/**
 * Apply per-model capability overrides at registry-load time.
 *
 * The generated `models.generated.ts` mirrors what the provider reports for
 * the default tier (e.g. Anthropic's 200k window for Opus 4.5). When the
 * capability table declares an opt-in that unlocks a larger window, the
 * registry should advertise that window so the UI (modeline, picker) and
 * compaction logic operate against the real ceiling we will request.
 *
 * Runtime discovery (see anthropic-discovery.ts) may also push fresher
 * model entries into the registry post-auth via `_registerModelForDiscovery`
 * below; this load-time pass is the cold-start fallback only.
 */
function applyCapabilityOverrides(model: Model<Api>): Model<Api> {
	if (model.api !== "anthropic-messages" && model.api !== "bedrock-converse-stream") {
		return model;
	}
	const caps = getAnthropicCapabilities(model.id, model.provider);
	if (caps.contextWindow && caps.contextWindow !== model.contextWindow) {
		return { ...model, contextWindow: caps.contextWindow };
	}
	return model;
}

// Initialize registry from generated and static models on module load
for (const [provider, models] of Object.entries(BUILT_IN_MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, applyCapabilityOverrides(model as Model<Api>));
	}
	modelRegistry.set(provider, providerModels);
}

/**
 * Insert or upgrade a registry entry. Used by the discovery layer to surface
 * newly-discovered model ids (e.g. `claude-opus-4.6-1m` on Copilot) without
 * regenerating models.generated.ts.
 *
 * When an existing entry is present, the capability-related fields are
 * refreshed but the pricing is preserved (discovery endpoints rarely
 * report cost). When new, the fresh entry is inserted as-is.
 *
 * Fires registered change listeners so downstream snapshots
 * (e.g. coding-agent's ModelRegistry) can rebuild.
 */
function _registerModelForDiscovery(provider: string, model: Model<Api>): void {
	let providerModels = modelRegistry.get(provider);
	if (!providerModels) {
		providerModels = new Map();
		modelRegistry.set(provider, providerModels);
	}
	const prev = providerModels.get(model.id);
	const isNew = !prev;
	const merged: Model<Api> = prev
		? {
				...prev,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: model.input,
			}
		: model;
	providerModels.set(model.id, merged);
	if (isNew) notifyModelChange({ type: "added", provider, model: merged });
}

function _replaceDiscoveredModels(provider: string, models: Model<Api>[]): void {
	let providerModels = modelRegistry.get(provider);
	if (!providerModels) {
		providerModels = new Map();
		modelRegistry.set(provider, providerModels);
	}

	const staticModels = BUILT_IN_MODELS[provider as keyof typeof BUILT_IN_MODELS] as
		| Record<string, Model<Api>>
		| undefined;
	for (const modelId of discoveredModelIds.get(provider) ?? []) {
		const staticModel = staticModels?.[modelId];
		if (staticModel) {
			providerModels.set(modelId, staticModel);
		} else if (providerModels.delete(modelId)) {
			notifyModelChange({ type: "removed", provider, modelId });
		}
	}

	discoveredModelIds.set(provider, new Set(models.map((model) => model.id)));
	for (const model of models) {
		const isNew = !providerModels.has(model.id);
		providerModels.set(model.id, model);
		if (isNew) notifyModelChange({ type: "added", provider, model });
	}
}

function notifyModelChange(event: ModelRegistryChangeEvent): void {
	for (const listener of modelChangeListeners) {
		try {
			listener(event);
		} catch {
			// Listener errors must not break discovery.
		}
	}
}

export type ModelRegistryChangeEvent =
	| { type: "added"; provider: string; model: Model<Api> }
	| { type: "removed"; provider: string; modelId: string };
const modelChangeListeners: Array<(e: ModelRegistryChangeEvent) => void> = [];

/**
 * Subscribe to registry mutations performed by the discovery layer
 * (newly-published model ids). Returns an unsubscribe function.
 */
export function onModelRegistryChange(listener: (e: ModelRegistryChangeEvent) => void): () => void {
	modelChangeListeners.push(listener);
	return () => {
		const i = modelChangeListeners.indexOf(listener);
		if (i >= 0) modelChangeListeners.splice(i, 1);
	};
}

// Wire the registry-mutation hook into the discovery module so it does not
// need a back-reference to models.ts (which would cycle).
_setRegistryHook(_registerModelForDiscovery);
_setRegistryReplaceHook(_replaceDiscoveredModels);

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof BUILT_IN_MODELS)[TProvider],
> = (typeof BUILT_IN_MODELS)[TProvider][TModelId] extends { api: infer TApi }
	? TApi extends Api
		? TApi
		: never
	: never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof BUILT_IN_MODELS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId as string) as Model<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof BUILT_IN_MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(provider);
	return models
		? (Array.from(models.values()) as Model<ModelApi<TProvider, keyof (typeof BUILT_IN_MODELS)[TProvider]>>[])
		: [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

/**
 * Check if a model supports xhigh thinking level.
 *
 * Supported today:
 * - GPT-5.2 / GPT-5.3 / GPT-5.4 / GPT-5.5 model families
 * - Opus 4.6 models (xhigh maps to adaptive effort "max" on Anthropic-compatible providers)
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	if (
		model.id.includes("gpt-5.2") ||
		model.id.includes("gpt-5.3") ||
		model.id.includes("gpt-5.4") ||
		model.id.includes("gpt-5.5")
	) {
		return true;
	}

	if (getAnthropicCapabilities(model.id, model.provider).xhighEffort) {
		return true;
	}

	return false;
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
