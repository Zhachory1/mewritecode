/**
 * WS15: Registry loader — three-tier fallback chain.
 *
 * Resolution order (first readable + valid wins):
 *   1. ~/.cave/agent/registry.json      (user override)
 *   2. ~/.cave/agent/registry-cache.json (fetched cache)
 *   3. <package>/registry/registry.json  (bundled fallback)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Registry, validateRegistry } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** User override path: ~/.cave/agent/registry.json */
export function getUserOverridePath(configDir?: string): string {
	const base = configDir ?? join(homedir(), ".cave", "agent");
	return join(base, "registry.json");
}

/** Fetched cache path: ~/.cave/agent/registry-cache.json */
export function getCachePath(configDir?: string): string {
	const base = configDir ?? join(homedir(), ".cave", "agent");
	return join(base, "registry-cache.json");
}

/**
 * Bundled fallback path: <package-root>/registry/registry.json
 *
 * Works from both src/ (ts-node / tsx) and dist/ (compiled) since the
 * registry/ dir lives at the package root, one or two levels up from
 * src/registry/ or dist/registry/.
 */
export function getBundledRegistryPath(): string {
	// Preferred: registry copied next to the compiled loader at build time
	// (dist/registry/registry.json). This is the only path that resolves when
	// the package is installed from npm, since the repo-root registry/ dir is
	// not published.
	const adjacentPath = join(__dirname, "registry.json");
	if (existsSync(adjacentPath)) return adjacentPath;

	// Monorepo dev/tests: loader runs from src/registry or dist/registry.
	// __dirname is:
	//   src:  packages/ai/src/registry    (4 levels up = repo root)
	//   dist: packages/ai/dist/registry   (4 levels up = repo root)
	// Structure: .../registry -> .../src|dist -> packages/ai -> packages -> repo-root
	const repoRoot = join(__dirname, "..", "..", "..", "..");
	const repoPath = join(repoRoot, "registry", "registry.json");
	if (existsSync(repoPath)) return repoPath;

	// Secondary fallback: probe 3 levels up (edge case for flattened dist)
	const altRoot = join(__dirname, "..", "..", "..");
	return join(altRoot, "..", "registry", "registry.json");
}

// ---------------------------------------------------------------------------
// Load result type
// ---------------------------------------------------------------------------

export type LoadRegistrySource = "user-override" | "cache" | "bundled";

export type LoadRegistryResult =
	| { ok: true; registry: Registry; source: LoadRegistrySource }
	| { ok: false; error: string; tried: string[] };

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Load the active registry following the three-tier fallback chain.
 *
 * @param configDir  Override ~/.cave/agent base dir (useful in tests).
 */
export function loadRegistry(configDir?: string): LoadRegistryResult {
	const candidates: Array<{ source: LoadRegistrySource; path: string }> = [
		{ source: "user-override", path: getUserOverridePath(configDir) },
		{ source: "cache", path: getCachePath(configDir) },
		{ source: "bundled", path: getBundledRegistryPath() },
	];

	const tried: string[] = [];

	for (const { source, path } of candidates) {
		if (!existsSync(path)) {
			tried.push(`${source}: ${path} (not found)`);
			continue;
		}

		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(path, "utf-8"));
		} catch (err) {
			tried.push(`${source}: ${path} (parse error: ${err instanceof Error ? err.message : String(err)})`);
			continue;
		}

		const result = validateRegistry(raw);
		if (!result.ok) {
			tried.push(`${source}: ${path} (invalid: ${result.errors.join("; ")})`);
			continue;
		}

		return { ok: true, registry: result.registry, source };
	}

	return {
		ok: false,
		error: "No valid registry found in any location",
		tried,
	};
}
