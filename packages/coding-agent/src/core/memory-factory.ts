/**
 * Shared MemoryProvider factory.
 *
 * AgentSession, the `/memory` slash command and the print-mode driver all need
 * the same backend instance: files by default, or cavemem when explicitly configured.
 * Constructing one provider per surface (as
 * interactive-mode.ts:4438 used to) means caches and MCP connections aren't
 * reused; this module hands out one cached instance per cwd.
 */

import { join } from "node:path";
import { memory as memoryNs } from "@zhachory1/mewrite-agent";
import { CONFIG_DIR_NAME } from "../config.js";

type MemoryProvider = memoryNs.MemoryProvider;

export interface MemoryFactorySettings {
	enabled: boolean;
	backend: "cavemem" | "files";
	command?: string;
	capture: { requirePreview: boolean };
	retrieval: { enabled: boolean; maxResults: number };
}

export interface MemoryFactoryOptions {
	cwd: string;
	settings?: MemoryFactorySettings;
	/** Optional override for tests. */
	cavememOptions?: memoryNs.CavememProviderOptions;
}

interface CacheEntry {
	provider: MemoryProvider;
	cwd: string;
	cacheKey: string;
}

const _cache = new Map<string, CacheEntry>();

function cacheKey(cwd: string, settings: MemoryFactorySettings | undefined): string {
	return `${settings?.backend ?? "files"}::${settings?.command ?? ""}::${cwd}`;
}

/**
 * Returns a MemoryProvider for `cwd`. Files is the deterministic default; cavemem
 * is used only when explicitly configured. Cached per-cwd so
 * successive `/memory` commands and the `transformContext` chain hit the same instance.
 */
export async function resolveMemoryProvider(opts: MemoryFactoryOptions): Promise<MemoryProvider> {
	const key = cacheKey(opts.cwd, opts.settings);
	const cached = _cache.get(key);
	if (cached) return cached.provider;

	let provider: MemoryProvider;
	if (opts.settings?.backend === "cavemem") {
		provider = new memoryNs.CavememProvider({ binary: opts.settings.command, ...opts.cavememOptions });
	} else {
		provider = new memoryNs.FilesProvider({ cwd: opts.cwd, memoryDir: join(opts.cwd, CONFIG_DIR_NAME, "memory") });
	}
	_cache.set(key, { provider, cwd: opts.cwd, cacheKey: key });
	return provider;
}

/** Drop cached providers (test helper). */
export function resetMemoryProviderCache(): void {
	_cache.clear();
}
