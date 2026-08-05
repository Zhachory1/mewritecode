import type { Api, KnownProvider, Model, Provider } from "./types.js";

/**
 * Capability tiers for subagent model selection. A tier keyword resolves to a
 * concrete model within the caller's current provider via the curated
 * {@link MODEL_TIERS} map, so it works regardless of which single provider the
 * user is authed to.
 */
export type Tier = "fast" | "normal" | "strong";

/** Prefix that marks a model string as a tier keyword (e.g. `tier:fast`). */
const TIER_SIGIL = "tier:";

/**
 * Parse a model string into a {@link Tier}, or undefined if it is not a tier
 * keyword. Tier keywords carry a `tier:` sigil so they never collide with a
 * concrete model id that happens to be named `fast`/`normal`/`strong`.
 */
export function parseTier(model: string | undefined): Tier | undefined {
	if (!model || !model.startsWith(TIER_SIGIL)) return undefined;
	const suffix = model.slice(TIER_SIGIL.length);
	return suffix === "fast" || suffix === "normal" || suffix === "strong" ? suffix : undefined;
}

/**
 * Maintainer-curated tier -> concrete-model-id map, per provider. Pinned (not a
 * runtime cost heuristic) so tier resolution is deterministic and the ladder is
 * controlled here. `normal` is a deliberately chosen everyday model, not the
 * provider's default (which tends to be the priciest / `strong` end).
 *
 * Partial: uncurated providers (routers like openrouter/vercel, or a user's
 * custom provider) have no row; callers fall back to the parent model with a
 * warning rather than guessing.
 *
 * Ids are patterns resolved through alias logic, so an alias like
 * `claude-sonnet-5` matches a future dated `claude-sonnet-5-YYYYMMDD`.
 */
export const MODEL_TIERS: Partial<Record<KnownProvider, Record<Tier, string>>> = {
	anthropic: { fast: "claude-haiku-4-5", normal: "claude-sonnet-5", strong: "claude-opus-4-8" },
	"openai-codex": { fast: "gpt-5.6-luna", normal: "gpt-5.6-terra", strong: "gpt-5.6-sol" },
	openai: { fast: "gpt-5.6-luna", normal: "gpt-5.6-terra", strong: "gpt-5.6-sol" },
	google: { fast: "gemini-2.5-flash", normal: "gemini-2.5-pro", strong: "gemini-3-pro-preview" },
	"amazon-bedrock": { fast: "claude-haiku-4-5", normal: "claude-sonnet-5", strong: "claude-opus-4-8" },
};

/** A model id is an "alias" when it has no trailing date (`-YYYYMMDD`). */
function isAlias(id: string): boolean {
	return id.endsWith("-latest") || !/-\d{8}$/.test(id);
}

/**
 * Match a curated tier id against one provider's authed pool. The pool is
 * already provider-scoped, so this is simpler than the general cross-provider
 * resolver: exact id, else alias-preferring partial match.
 */
function matchInPool(wantId: string, pool: Model<Api>[]): Model<Api> | undefined {
	const want = wantId.toLowerCase();
	const exact = pool.find((m) => m.id.toLowerCase() === want);
	if (exact) return exact;

	const matches = pool.filter((m) => m.id.toLowerCase().includes(want) || m.name?.toLowerCase().includes(want));
	if (matches.length === 0) return undefined;

	const aliases = matches.filter((m) => isAlias(m.id));
	const pick = (aliases.length > 0 ? aliases : matches).sort((a, b) => b.id.localeCompare(a.id));
	return pick[0];
}

/**
 * Resolve a tier to a concrete authed model for a provider, or undefined when
 * the provider is uncurated or the curated id is not in the authed pool. The
 * caller decides the fallback (curated `normal`, then parent model).
 */
export function resolveTier(tier: Tier, provider: Provider, authed: Model<Api>[]): Model<Api> | undefined {
	const row = MODEL_TIERS[provider as KnownProvider];
	if (!row) return undefined;
	const pool = authed.filter((m) => m.provider === provider);
	if (pool.length === 0) return undefined;
	return matchInPool(row[tier], pool);
}
