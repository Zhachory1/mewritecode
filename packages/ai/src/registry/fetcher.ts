/**
 * WS15: Registry fetcher — HTTP fetch + atomic cache write.
 *
 * Fetches the registry from the remote URL, validates it, and writes to
 * ~/.cave/agent/registry-cache.json atomically (write-then-rename).
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Registry, validateRegistry } from "./schema.js";

export type FetchChannel = "stable" | "beta";

const REGISTRY_URLS: Record<FetchChannel, string> = {
	stable: "https://raw.githubusercontent.com/Zhachory1/mewritecode/main/registry/registry.json",
	beta: "https://raw.githubusercontent.com/Zhachory1/mewritecode/main/registry/registry.json",
};

/** Default timeout for registry fetch (ms) */
const FETCH_TIMEOUT_MS = 10_000;

export type FetchRegistryResult = { ok: true; registry: Registry; cached: boolean } | { ok: false; error: string };

/**
 * Fetch registry JSON from remote URL, validate, and atomically write to
 * cachePath. Returns the validated Registry on success.
 *
 * @param cachePath  Absolute path to write the cache file.
 * @param channel    "stable" (default) or "beta".
 * @param fetchImpl  Injectable fetch (defaults to globalThis.fetch / Node 18+).
 */
export async function fetchAndCacheRegistry(
	cachePath: string,
	channel: FetchChannel = "stable",
	fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchRegistryResult> {
	const url = REGISTRY_URLS[channel];

	let raw: unknown;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const response = await fetchImpl(url, { signal: controller.signal });
		clearTimeout(timer);

		if (!response.ok) {
			return {
				ok: false,
				error: `HTTP ${response.status} fetching registry from ${url}`,
			};
		}

		raw = await response.json();
	} catch (err) {
		return {
			ok: false,
			error: `Failed to fetch registry: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const result = validateRegistry(raw);
	if (!result.ok) {
		return {
			ok: false,
			error: `Registry validation failed:\n${result.errors.join("\n")}`,
		};
	}

	// Atomic write: write to tmp then rename
	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		const tmpPath = join(tmpdir(), `cave-registry-${Date.now()}.json`);
		writeFileSync(tmpPath, JSON.stringify(result.registry, null, 2), "utf-8");
		renameSync(tmpPath, cachePath);
	} catch (err) {
		return {
			ok: false,
			error: `Failed to write registry cache: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	return { ok: true, registry: result.registry, cached: true };
}
