/**
 * Shared MemoryProvider factory.
 *
 * AgentSession, the `/memory` slash command and the print-mode driver all need
 * the same backend instance: zbrain by default, or cavemem/files when configured.
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
	backend: "zbrain" | "cavemem" | "files";
	command?: string;
	workspace: string;
	capture: { requirePreview: boolean; defaultCollection: string };
	retrieval: { enabled: boolean; maxResults: number };
}

export interface MemoryFactoryOptions {
	cwd: string;
	settings?: MemoryFactorySettings;
	/** When false, force the FilesProvider fallback (skips cavemem probe). */
	allowCavemem?: boolean;
	/** Optional override for tests. */
	cavememOptions?: memoryNs.CavememProviderOptions;
	zbrainOptions?: memoryNs.ZbrainProviderOptions;
}

interface CacheEntry {
	provider: MemoryProvider;
	cwd: string;
	cacheKey: string;
}

const _cache = new Map<string, CacheEntry>();

function cacheKey(cwd: string, settings: MemoryFactorySettings | undefined, allowCavemem: boolean): string {
	if (!settings) return `${allowCavemem ? "cm" : "fs"}::${cwd}`;
	return `${settings.backend}::${settings.command ?? ""}::${settings.workspace}::${settings.capture.defaultCollection}::${cwd}`;
}

/**
 * Returns a MemoryProvider for `cwd`. zbrain is the default configured backend;
 * cavemem/files remain available for legacy setups and tests. Cached per-cwd so
 * successive `/memory` commands and the `transformContext` chain hit the same instance.
 */
export async function resolveMemoryProvider(opts: MemoryFactoryOptions): Promise<MemoryProvider> {
	const allowCavemem = opts.allowCavemem !== false;
	const key = cacheKey(opts.cwd, opts.settings, allowCavemem);
	const cached = _cache.get(key);
	if (cached) return cached.provider;

	let provider: MemoryProvider;
	const backend = opts.settings?.backend;
	if (backend === "zbrain") {
		provider = new memoryNs.ZbrainProvider({
			command: opts.settings?.command,
			workspace: opts.settings?.workspace,
			defaultCollection: opts.settings?.capture.defaultCollection,
			...opts.zbrainOptions,
		});
	} else if (backend === "cavemem") {
		provider = new memoryNs.CavememProvider({ binary: opts.settings?.command, ...opts.cavememOptions });
	} else if (backend === "files") {
		provider = new memoryNs.FilesProvider({ cwd: opts.cwd, memoryDir: join(opts.cwd, CONFIG_DIR_NAME, "memory") });
	} else if (allowCavemem) {
		const cavemem = new memoryNs.CavememProvider(opts.cavememOptions);
		const ok = await cavemem.isAvailable().catch(() => false);
		provider = ok
			? cavemem
			: new memoryNs.FilesProvider({ cwd: opts.cwd, memoryDir: join(opts.cwd, CONFIG_DIR_NAME, "memory") });
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
