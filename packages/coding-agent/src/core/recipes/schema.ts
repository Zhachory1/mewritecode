/**
 * WS14: Recipe schema — Goose-style YAML recipes for cave.
 *
 * Schema is intentionally a strict superset of Goose's recipe format
 * (block.github.io/goose) so recipes authored for Goose work unchanged.
 *
 * Zod is NOT in coding-agent's direct deps; we implement lightweight
 * manual validation that produces the same DX (field-level error messages).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecipeEffort = "low" | "medium" | "high";

export interface RecipeInput {
	description: string;
	required?: boolean;
	default?: string;
}

/**
 * Parsed, validated recipe definition.
 */
export interface Recipe {
	/** Short description of what the recipe does (used as the agent goal). May contain {{var}} placeholders. */
	goal: string;
	/** Allowlisted tool names for this session. Undefined = all tools available. */
	tools?: string[];
	/** Explicitly disallowed tool names. */
	disallowedTools?: string[];
	/** Model name / pattern to use. Falls back to the user's configured default. */
	model?: string;
	/** Effort level passed to the agent. */
	effort?: RecipeEffort;
	/** Environment variables set before running. */
	env?: Record<string, string>;
	/** Sub-recipe names or paths to inline-expand before running. */
	include?: string[];
	/** Named input parameters that callers supply via --input k=v. */
	inputs?: Record<string, RecipeInput>;
	/** Name of the recipe (filled in by the loader, not the YAML). */
	name?: string;
	/** Absolute path of the source file (filled in by the loader). */
	filePath?: string;
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export class RecipeValidationError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly filePath?: string,
	) {
		super(message);
		this.name = "RecipeValidationError";
	}
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

const VALID_EFFORTS = new Set<string>(["low", "medium", "high"]);

function assertString(value: unknown, field: string, filePath?: string): string {
	if (typeof value !== "string") {
		throw new RecipeValidationError(`"${field}" must be a string, got ${typeof value}`, field, filePath);
	}
	return value;
}

function assertStringArray(value: unknown, field: string, filePath?: string): string[] {
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
		throw new RecipeValidationError(`"${field}" must be an array of strings`, field, filePath);
	}
	return value as string[];
}

function assertStringRecord(value: unknown, field: string, filePath?: string): Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RecipeValidationError(`"${field}" must be a string→string object`, field, filePath);
	}
	for (const [k, v] of Object.entries(value)) {
		if (typeof v !== "string") {
			throw new RecipeValidationError(
				`"${field}.${k}" must be a string, got ${typeof v}`,
				`${field}.${k}`,
				filePath,
			);
		}
	}
	return value as Record<string, string>;
}

function validateInputDef(raw: unknown, key: string, filePath?: string): RecipeInput {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new RecipeValidationError(
			`inputs.${key} must be an object with a "description" string`,
			`inputs.${key}`,
			filePath,
		);
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.description !== "string") {
		throw new RecipeValidationError(
			`inputs.${key}.description must be a string`,
			`inputs.${key}.description`,
			filePath,
		);
	}
	const def: RecipeInput = { description: obj.description };
	if (obj.required !== undefined) {
		if (typeof obj.required !== "boolean") {
			throw new RecipeValidationError(
				`inputs.${key}.required must be a boolean`,
				`inputs.${key}.required`,
				filePath,
			);
		}
		def.required = obj.required;
	}
	if (obj.default !== undefined) {
		def.default = assertString(obj.default, `inputs.${key}.default`, filePath);
	}
	return def;
}

/**
 * Validate a raw YAML-parsed object and return a typed Recipe.
 * Throws RecipeValidationError with a descriptive message on failure.
 */
export function validateRecipe(raw: unknown, filePath?: string): Recipe {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new RecipeValidationError("Recipe must be a YAML object", undefined, filePath);
	}

	const obj = raw as Record<string, unknown>;

	// Required: goal
	if (!("goal" in obj) || obj.goal === undefined || obj.goal === null || obj.goal === "") {
		throw new RecipeValidationError('"goal" is required and must be a non-empty string', "goal", filePath);
	}
	const goal = assertString(obj.goal, "goal", filePath);
	if (!goal.trim()) {
		throw new RecipeValidationError('"goal" must not be blank', "goal", filePath);
	}

	const recipe: Recipe = { goal };

	if ("tools" in obj && obj.tools !== undefined) {
		recipe.tools = assertStringArray(obj.tools, "tools", filePath);
	}

	if ("disallowedTools" in obj && obj.disallowedTools !== undefined) {
		recipe.disallowedTools = assertStringArray(obj.disallowedTools, "disallowedTools", filePath);
	}

	if ("model" in obj && obj.model !== undefined) {
		recipe.model = assertString(obj.model, "model", filePath);
	}

	if ("effort" in obj && obj.effort !== undefined) {
		const effort = assertString(obj.effort, "effort", filePath);
		if (!VALID_EFFORTS.has(effort)) {
			throw new RecipeValidationError(
				`"effort" must be one of: ${[...VALID_EFFORTS].join(", ")}`,
				"effort",
				filePath,
			);
		}
		recipe.effort = effort as RecipeEffort;
	}

	if ("env" in obj && obj.env !== undefined) {
		recipe.env = assertStringRecord(obj.env, "env", filePath);
	}

	if ("include" in obj && obj.include !== undefined) {
		recipe.include = assertStringArray(obj.include, "include", filePath);
	}

	if ("inputs" in obj && obj.inputs !== undefined) {
		if (typeof obj.inputs !== "object" || obj.inputs === null || Array.isArray(obj.inputs)) {
			throw new RecipeValidationError('"inputs" must be an object', "inputs", filePath);
		}
		const inputsRaw = obj.inputs as Record<string, unknown>;
		const inputs: Record<string, RecipeInput> = {};
		for (const [key, val] of Object.entries(inputsRaw)) {
			inputs[key] = validateInputDef(val, key, filePath);
		}
		recipe.inputs = inputs;
	}

	return recipe;
}
