/**
 * Shared MemoryProvider factory.
 *
 * AgentSession, the `/memory` slash command and the print-mode driver all need
 * the same backend instance: Cavemem by default, with FilesProvider only when
 * Cavemem is unavailable or explicitly configured.
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
	return `${settings?.backend ?? "cavemem"}::${settings?.command ?? ""}::${cwd}`;
}

/**
 * Returns a MemoryProvider for `cwd`. Cavemem is the default and is probed before
 * use; FilesProvider is used only when Cavemem is unavailable or explicitly selected.
 * Cached per-cwd so successive `/memory` commands and the `transformContext` chain
 * hit the same instance.
 */
export async function resolveMemoryProvider(opts: MemoryFactoryOptions): Promise<MemoryProvider> {
	const key = cacheKey(opts.cwd, opts.settings);
	const cached = _cache.get(key);
	if (cached) return cached.provider;

	const filesProvider = () =>
		new memoryNs.FilesProvider({ cwd: opts.cwd, memoryDir: join(opts.cwd, CONFIG_DIR_NAME, "memory") });
	const backend = opts.settings?.backend ?? "cavemem";
	let provider: MemoryProvider;
	if (backend === "files") {
		provider = filesProvider();
	} else {
		const cavemem = new memoryNs.CavememProvider({ binary: opts.settings?.command, ...opts.cavememOptions });
		provider = (await cavemem.isAvailable().catch(() => false)) ? cavemem : filesProvider();
	}
	_cache.set(key, { provider, cwd: opts.cwd, cacheKey: key });
	return provider;
}

/** Drop cached providers (test helper). */
export function resetMemoryProviderCache(): void {
	_cache.clear();
}
