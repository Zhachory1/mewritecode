/**
 * WS18 — Watch-Files file watcher.
 *
 * Uses Node.js `fs.watch` with a polling fallback for network mounts
 * (filesystems that don't support inotify). Debounces changes by 500ms.
 * Implements cycle protection: files modified by the agent itself within
 * the last 2s are ignored to prevent re-trigger loops.
 */

import { statSync, watch } from "node:fs";
import { extname, resolve } from "node:path";
import { type AgentRunFn, createTriggerContext, processTriggers, type TriggerContext } from "./trigger.js";

export interface WatcherOptions {
	/** Glob patterns or directory paths to watch. */
	paths: string[];
	/** Debounce delay in ms. Default 500. */
	debounceMs?: number;
	/** Cycle protection window in ms. Default 2000. */
	cycleProtectionMs?: number;
	/** File extensions to watch (without dot). Default: all source extensions. */
	extensions?: string[];
	/** Polling interval ms. Set to enable polling fallback. Default: undefined (native). */
	pollIntervalMs?: number;
}

export const DEFAULT_WATCH_EXTENSIONS = [
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"py",
	"rb",
	"go",
	"rs",
	"c",
	"cpp",
	"cc",
	"h",
	"java",
	"kt",
	"swift",
	"php",
	"lua",
	"sql",
	"sh",
	"bash",
	"zsh",
];

/**
 * A running watcher instance returned by startWatcher.
 */
export interface WatcherHandle {
	/** Stop the watcher and release all resources. */
	stop(): void;
}

/**
 * Start the file watcher.
 *
 * @param options — watcher configuration
 * @param agentRun — callback to dispatch triggers to the agent
 * @returns WatcherHandle to stop the watcher
 */
export function startWatcher(options: WatcherOptions, agentRun: AgentRunFn): WatcherHandle {
	const debounceMs = options.debounceMs ?? 500;
	const cycleProtectionMs = options.cycleProtectionMs ?? 2000;
	const allowedExts = new Set(options.extensions ?? DEFAULT_WATCH_EXTENSIONS);

	// Track recently-agent-modified files for cycle protection
	const agentModifiedAt = new Map<string, number>();

	// Mark a file as agent-modified (called by agentRun wrapper)
	function markAgentModified(filePath: string): void {
		agentModifiedAt.set(filePath, Date.now());
	}

	// Debounce timers: filePath → NodeJS.Timeout
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// Per-file trigger context (accumulates "cave" context comments)
	const triggerContexts = new Map<string, TriggerContext>();

	function getTriggerCtx(filePath: string): TriggerContext {
		let ctx = triggerContexts.get(filePath);
		if (!ctx) {
			ctx = createTriggerContext();
			triggerContexts.set(filePath, ctx);
		}
		return ctx;
	}

	// Wrapped agentRun that marks files as agent-modified after completion
	async function wrappedAgentRun(prompt: string, filePath: string, isReadOnly: boolean): Promise<string> {
		const result = await agentRun(prompt, filePath, isReadOnly);
		if (!isReadOnly) {
			markAgentModified(filePath);
		}
		return result;
	}

	function handleFileChange(filePath: string): void {
		const resolved = resolve(filePath);
		const ext = extname(resolved).replace(/^\./, "").toLowerCase();

		if (!allowedExts.has(ext)) return;

		// Cycle protection: skip if agent modified this file recently
		const lastModified = agentModifiedAt.get(resolved);
		if (lastModified !== undefined && Date.now() - lastModified < cycleProtectionMs) {
			return;
		}

		// Debounce
		const existing = debounceTimers.get(resolved);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(async () => {
			debounceTimers.delete(resolved);
			const ctx = getTriggerCtx(resolved);
			try {
				await processTriggers(resolved, ctx, wrappedAgentRun);
			} catch (err) {
				process.stderr.write(
					`[cave watch] unhandled error processing ${resolved}: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			}
		}, debounceMs);

		debounceTimers.set(resolved, timer);
	}

	const watchers: ReturnType<typeof watch>[] = [];
	const pollIntervals: ReturnType<typeof setInterval>[] = [];

	for (const watchPath of options.paths) {
		const resolved = resolve(watchPath);

		if (options.pollIntervalMs) {
			// Polling fallback: stat mtime on interval
			const mtimes = new Map<string, number>();

			const pollInterval = setInterval(() => {
				try {
					const st = statSync(resolved);
					const prev = mtimes.get(resolved);
					const current = st.mtimeMs;
					if (prev !== undefined && current !== prev) {
						handleFileChange(resolved);
					}
					mtimes.set(resolved, current);
				} catch {
					// File may not exist yet
				}
			}, options.pollIntervalMs);

			pollIntervals.push(pollInterval);
		} else {
			// Native fs.watch (supports recursive on macOS/Windows)
			try {
				const watcher = watch(resolved, { recursive: true }, (_event, filename) => {
					if (!filename) return;
					const fullPath = resolve(resolved, filename);
					handleFileChange(fullPath);
				});

				watcher.on("error", (err) => {
					process.stderr.write(`[cave watch] watcher error on ${resolved}: ${err.message}\n`);
				});

				watchers.push(watcher);
			} catch (err) {
				process.stderr.write(
					`[cave watch] failed to watch ${resolved}: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			}
		}
	}

	return {
		stop() {
			for (const timer of debounceTimers.values()) clearTimeout(timer);
			debounceTimers.clear();

			for (const interval of pollIntervals) clearInterval(interval);
			pollIntervals.length = 0;

			for (const w of watchers) {
				try {
					w.close();
				} catch {
					// ignore
				}
			}
			watchers.length = 0;
		},
	};
}
