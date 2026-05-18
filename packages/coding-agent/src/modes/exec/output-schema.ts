/**
 * WS16: JSON Schema validation for --output-schema.
 *
 * Uses AJV (already a dependency of the coding-agent package) to validate
 * the final assistant message text against a user-supplied JSON Schema file.
 *
 * If the assistant output is valid JSON it is parsed and validated as an
 * object; otherwise the raw string is wrapped as { "text": "<output>" }
 * before validation, which allows schemas to match text output too.
 */

import { readFileSync } from "node:fs";
import AjvModule from "ajv";
import { EXIT_SCHEMA_VALIDATION_FAILED } from "./exit-codes.js";

// AJV ships as CJS with a default export — handle both module styles.
const Ajv = (AjvModule as unknown as { default?: unknown }).default ?? AjvModule;

export interface SchemaValidationResult {
	ok: boolean;
	/** Human-readable error string when ok === false. */
	error?: string;
}

/**
 * Load a JSON Schema from a file path.
 * Throws ExecUserConfigError on parse failure (so the caller can map to exit 6).
 */
export function loadSchema(schemaPath: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(schemaPath, "utf-8");
	} catch (err) {
		throw new Error(`Cannot read schema file "${schemaPath}": ${(err as Error).message}`);
	}

	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		throw new Error(`Schema file "${schemaPath}" is not valid JSON: ${(err as Error).message}`);
	}
}

/**
 * Validate a string (the final assistant output) against a JSON Schema.
 *
 * - If the string is valid JSON, it is used directly.
 * - Otherwise it is wrapped as { text: "<string>" } so plain-text schemas
 *   can also be validated (e.g. `{ "required": ["text"] }`).
 *
 * Returns EXIT_SCHEMA_VALIDATION_FAILED (2) on mismatch, 0 on success.
 */
export function validateOutput(output: string, schema: Record<string, unknown>): SchemaValidationResult {
	const AjvCtor = Ajv as unknown as new (
		opts: unknown,
	) => {
		compile: (schema: unknown) => ((d: unknown) => boolean) & { errors?: unknown[] | null };
		errorsText: (errors?: unknown[] | null) => string;
	};
	const ajv = new AjvCtor({ allErrors: true });

	let data: unknown;
	try {
		data = JSON.parse(output);
	} catch {
		// Not JSON — wrap so schema can still match if it expects { text: string }
		data = { text: output };
	}

	let validate: ReturnType<typeof ajv.compile>;
	try {
		validate = ajv.compile(schema);
	} catch (err) {
		return {
			ok: false,
			error: `Invalid schema: ${(err as Error).message}`,
		};
	}

	const valid = validate(data);
	if (!valid) {
		const errors = ajv.errorsText(validate.errors);
		return { ok: false, error: `Schema validation failed: ${errors}` };
	}

	return { ok: true };
}

export { EXIT_SCHEMA_VALIDATION_FAILED };
