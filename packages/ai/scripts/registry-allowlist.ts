import type { RegistryProvider } from "../src/registry/schema.js";

/**
 * Curated allowlist that drives `scripts/generate-registry.ts`.
 *
 * The registry only overlays pricing/context onto the built-in model catalog,
 * so this list is deliberately small and hand-maintained. The generator
 * refreshes pricing/context/capabilities for exactly these ids from
 * `src/models.generated.ts` (MODELS) — it never adds or removes models.
 *
 * To change the set of models: edit `models` (or add a provider block), then
 * run `npm run generate-registry`. Every id must exist under the given
 * `source` key in MODELS or generation fails.
 */
export interface AllowlistProvider {
	/** Registry provider id (also the output `id`). */
	name: string;
	kind: RegistryProvider["kind"];
	auth: RegistryProvider["auth"];
	baseUrl?: string;
	/** Provider key in MODELS (src/models.generated.ts) to pull pricing from. */
	source: string;
	/** MODELS model ids to include, in output order. */
	models: string[];
}

export const REGISTRY_ALLOWLIST: Record<string, AllowlistProvider> = {
	anthropic: {
		name: "Anthropic",
		kind: "anthropic",
		auth: "api-key",
		baseUrl: "https://api.anthropic.com",
		source: "anthropic",
		models: ["claude-opus-4-8", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
	},
	openai: {
		name: "OpenAI",
		kind: "openai",
		auth: "api-key",
		baseUrl: "https://api.openai.com/v1",
		source: "openai",
		models: ["gpt-5.6", "gpt-5.1", "gpt-4.1", "gpt-4o", "o3", "o4-mini"],
	},
	google: {
		name: "Google",
		kind: "google",
		auth: "api-key",
		baseUrl: "https://generativelanguage.googleapis.com",
		source: "google",
		models: ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
	},
	openrouter: {
		name: "OpenRouter",
		kind: "openrouter",
		auth: "api-key",
		baseUrl: "https://openrouter.ai/api/v1",
		source: "openrouter",
		models: [
			"anthropic/claude-opus-4.8",
			"openai/gpt-4o",
			"google/gemini-2.5-pro",
			"deepseek/deepseek-v4-pro",
		],
	},
	mistral: {
		name: "Mistral",
		kind: "mistral",
		auth: "api-key",
		baseUrl: "https://api.mistral.ai",
		source: "mistral",
		models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
	},
	xai: {
		name: "xAI",
		kind: "xai",
		auth: "api-key",
		baseUrl: "https://api.x.ai/v1",
		source: "xai",
		models: ["grok-4.5", "grok-4.3", "grok-code-fast-1"],
	},
	groq: {
		name: "Groq",
		kind: "groq",
		auth: "api-key",
		baseUrl: "https://api.groq.com/openai/v1",
		source: "groq",
		models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
	},
	"github-copilot": {
		name: "GitHub Copilot",
		kind: "other",
		auth: "oauth",
		baseUrl: "https://api.githubcopilot.com",
		source: "github-copilot",
		models: ["claude-sonnet-4.5", "claude-opus-4.8", "gpt-5.4", "gemini-3.1-pro-preview"],
	},
};
