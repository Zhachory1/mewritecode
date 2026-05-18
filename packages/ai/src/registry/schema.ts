/**
 * WS15: Catwalk-style provider/model registry schema.
 *
 * Registry JSON schema defined with @sinclair/typebox (matches existing
 * @caveman-code/ai conventions — ajv + typebox, no zod dependency).
 *
 * Validation: use validateRegistry() which returns a typed result.
 */

import { type Static, Type } from "@sinclair/typebox";
import AjvModule from "ajv";

const Ajv = (AjvModule as any).default ?? AjvModule;
const ajv = new Ajv({ allErrors: true });

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const RegistryModelCapabilitySchema = Type.Union([
	Type.Literal("tools"),
	Type.Literal("vision"),
	Type.Literal("cache"),
	Type.Literal("reasoning"),
]);

export const RegistryModelSchema = Type.Object({
	/** Canonical model ID (e.g. "claude-sonnet-4-5") */
	id: Type.String({ minLength: 1 }),
	/** Human-readable display name */
	displayName: Type.String({ minLength: 1 }),
	/** Context window in tokens */
	contextWindow: Type.Number({ minimum: 1 }),
	/** Max output tokens */
	maxOutputTokens: Type.Optional(Type.Number({ minimum: 1 })),
	/** Input cost per million tokens (USD) */
	inputCostPerMtok: Type.Optional(Type.Number({ minimum: 0 })),
	/** Output cost per million tokens (USD) */
	outputCostPerMtok: Type.Optional(Type.Number({ minimum: 0 })),
	/** Supported capabilities */
	capabilities: Type.Optional(Type.Array(RegistryModelCapabilitySchema)),
});

export const RegistryProviderAuthSchema = Type.Union([
	Type.Literal("api-key"),
	Type.Literal("oauth"),
	Type.Literal("none"),
]);

export const RegistryProviderKindSchema = Type.Union([
	Type.Literal("anthropic"),
	Type.Literal("openai"),
	Type.Literal("google"),
	Type.Literal("openrouter"),
	Type.Literal("mistral"),
	Type.Literal("bedrock"),
	Type.Literal("gemini-cli"),
	Type.Literal("vertex"),
	Type.Literal("xai"),
	Type.Literal("groq"),
	Type.Literal("cerebras"),
	Type.Literal("other"),
]);

export const RegistryProviderOAuthSchema = Type.Object({
	authorizationUrl: Type.String({ minLength: 1 }),
	tokenUrl: Type.String({ minLength: 1 }),
	clientId: Type.String({ minLength: 1 }),
	scopes: Type.Array(Type.String()),
});

export const RegistryProviderSchema = Type.Object({
	/** Unique provider identifier (e.g. "anthropic", "openai") */
	id: Type.String({ minLength: 1 }),
	/** Human-readable name */
	name: Type.String({ minLength: 1 }),
	/** Provider API kind — maps to @caveman-code/ai Api type */
	kind: RegistryProviderKindSchema,
	/** Optional override base URL */
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	/** Auth mechanism */
	auth: RegistryProviderAuthSchema,
	/** OAuth config when auth === "oauth" */
	oauth: Type.Optional(RegistryProviderOAuthSchema),
	/** Models offered by this provider */
	models: Type.Array(RegistryModelSchema),
});

export const RegistrySchema = Type.Object({
	/** Semver of this registry snapshot */
	version: Type.String({ minLength: 1 }),
	/** Channel: stable | beta */
	channel: Type.Optional(Type.Union([Type.Literal("stable"), Type.Literal("beta")])),
	/** ISO-8601 timestamp of when this registry was published */
	publishedAt: Type.Optional(Type.String()),
	providers: Type.Array(RegistryProviderSchema),
});

// ---------------------------------------------------------------------------
// Compiled validator
// ---------------------------------------------------------------------------

const validate = ajv.compile(RegistrySchema);

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type RegistryModel = Static<typeof RegistryModelSchema>;
export type RegistryProvider = Static<typeof RegistryProviderSchema>;
export type Registry = Static<typeof RegistrySchema>;

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

export type RegistryValidationResult = { ok: true; registry: Registry } | { ok: false; errors: string[] };

/**
 * Validate a raw unknown value against the registry schema.
 * Returns typed Registry on success, or descriptive error strings on failure.
 */
export function validateRegistry(raw: unknown): RegistryValidationResult {
	if (validate(raw)) {
		return { ok: true, registry: raw as Registry };
	}

	const errors = (validate.errors ?? []).map(
		(e: { instancePath?: string; message?: string }) =>
			`  - ${e.instancePath || "(root)"}: ${e.message ?? "invalid"}`,
	);

	return { ok: false, errors };
}
