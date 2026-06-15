/**
 * MemoryInjector — per-session cavemem-backed retrieval injection (WS7).
 *
 * Extracted verbatim from `agent-session.ts` (god-file decomposition #16,
 * stage 2). Owns the memory provider lifecycle, the recall cache + single-flight
 * build, the first-turn session prelude, and the per-turn transform that injects
 * a `memory-recall` (and optional `memory-prelude`) block before the latest user
 * message.
 *
 * Behavior-preserving move: the logic, caching, single-flight, timeouts, and
 * message insertion are unchanged from the original AgentSession methods.
 * AgentSession keeps a `_memoryInjector` instance and delegates its public
 * memory methods to it; the `transformContext` chain calls `buildTransform(...)`.
 * `_mergeRetrievalInjections` STAYS in AgentSession and reads `tokenCap` from
 * this injector. The `memory_search`/`memory_save` tool registration STAYS in
 * AgentSession's `_buildRuntime`, which primes this injector's provider via
 * {@link MemoryInjector.primeProvider} to share the resolved instance.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@juliusbrussee/caveman-agent";
import { memory as memoryNs } from "@juliusbrussee/caveman-agent";
import { composeStartupPrelude } from "./memory-bridge.js";
import { resolveMemoryProvider } from "./memory-factory.js";

type MemoryProviderInstance = memoryNs.MemoryProvider;

export interface MemoryInjectorOptions {
	cwd: string;
	timeoutMs: number;
	tokenCap: number;
	/**
	 * Returns the basenames of the most-recent in-chat files (repomap chat-state).
	 * Used to seed the recall query alongside the latest user message.
	 */
	recentFileNames: () => string[];
}

export class MemoryInjector {
	private readonly _cwd: string;
	private readonly _timeoutMs: number;
	private readonly _tokenCap: number;
	private readonly _recentFileNames: () => string[];

	private _provider: MemoryProviderInstance | undefined;
	private _providerInit: Promise<MemoryProviderInstance | undefined> | undefined;
	private _enabled = true;
	private _recallCache: { hash: string; rendered: string } | undefined;
	private _recallBuildPromise: Promise<void> | undefined;
	private _preludeInjected = false;

	constructor(opts: MemoryInjectorOptions) {
		this._cwd = opts.cwd;
		this._timeoutMs = opts.timeoutMs;
		this._tokenCap = opts.tokenCap;
		this._recentFileNames = opts.recentFileNames;
	}

	/** Token cap consumed by AgentSession's `_mergeRetrievalInjections`. */
	get tokenCap(): number {
		return this._tokenCap;
	}

	/** Toggle memory recall and write hooks for this session. */
	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		if (!enabled) this._recallCache = undefined;
	}

	get enabled(): boolean {
		return this._enabled;
	}

	/**
	 * Seed the shared provider instance (called by AgentSession's `_buildRuntime`
	 * tool registration so cavemem / FilesProvider is built once and shared with
	 * the `/memory` slash command + the recall transform).
	 */
	primeProvider(provider: MemoryProviderInstance | undefined): void {
		this._provider = provider;
	}

	/**
	 * Resolve (and lazily build) the active memory provider. Cavemem when its
	 * CLI is on $PATH; FilesProvider over `<cwd>/.cave/memory/` otherwise.
	 *
	 * Returns the same instance the `/memory` slash command should use so the
	 * MCP transport, embedding model, and FTS handles are reused.
	 */
	async getProvider(): Promise<MemoryProviderInstance | undefined> {
		if (this._provider) return this._provider;
		if (!this._providerInit) {
			this._providerInit = resolveMemoryProvider({ cwd: this._cwd })
				.then((p) => {
					this._provider = p;
					return p;
				})
				.catch((err) => {
					console.warn(`[cave/memory] provider init failed: ${err instanceof Error ? err.message : String(err)}`);
					return undefined;
				});
		}
		return this._providerInit;
	}

	private _latestUserText(messages: AgentMessage[]): string {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "user") continue;
			if (Array.isArray(m.content)) {
				return m.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
			}
			if (typeof m.content === "string") return m.content;
			return "";
		}
		return "";
	}

	/** Build the search query from chat-state + last user message. */
	private _query(messages: AgentMessage[]): string {
		const text = this._latestUserText(messages).slice(0, 500);
		const fileNames = this._recentFileNames();
		return [text, ...fileNames]
			.filter((s) => s && s.length > 0)
			.join("  ")
			.trim();
	}

	private _hash(query: string): string {
		// Cache the rendered recall keyed by query — same input ⇒ skip provider call.
		const trimmed = query.replace(/\s+/g, " ").trim();
		return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
	}

	private async _withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
		return new Promise<T>((resolve) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve(fallback);
			}, ms);
			promise
				.then((v) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(v);
				})
				.catch(() => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(fallback);
				});
		});
	}

	private async _renderRecall(provider: MemoryProviderInstance, query: string): Promise<string | undefined> {
		const hits = await this._withTimeout(provider.search(query, { limit: 5 }), this._timeoutMs, []);
		if (!hits || hits.length === 0) return undefined;
		const ids = hits.map((h) => h.id).filter((id) => Number.isFinite(id) && id >= 0);
		let bodies: memoryNs.MemoryObservation[] = [];
		if (ids.length > 0) {
			bodies = await this._withTimeout(provider.getObservations(ids, { expand: false }), this._timeoutMs, []);
		}
		const byId = new Map(bodies.map((b) => [b.id, b]));
		const rows = hits
			.map((h) => {
				const body = byId.get(h.id);
				const preview = (body?.content ?? h.preview ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
				const kind = body?.kind ?? h.kind ?? "fact";
				const ts = body?.ts ?? h.ts ?? "";
				return `- #${h.id} [${kind}]${ts ? ` ${ts}` : ""} — ${preview}`;
			})
			.filter((r) => r.includes("—"));
		if (rows.length === 0) return undefined;
		return rows.join("\n");
	}

	private async _getOrBuildRecall(query: string): Promise<string | undefined> {
		if (!query) return undefined;
		const provider = await this.getProvider();
		if (!provider) return undefined;
		const available = await this._withTimeout(provider.isAvailable(), 500, false);
		if (!available) return undefined;

		const hash = this._hash(query);
		if (this._recallCache?.hash === hash) return this._recallCache.rendered;

		if (this._recallBuildPromise) {
			await this._recallBuildPromise;
			if (this._recallCache?.hash === hash) return this._recallCache.rendered;
		}

		const buildPromise = (async () => {
			try {
				const rendered = await this._renderRecall(provider, query);
				if (rendered) {
					this._recallCache = { hash, rendered };
				} else {
					this._recallCache = { hash, rendered: "" };
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.warn(`[cave/memory] recall failed: ${message}`);
				this._recallCache = { hash, rendered: "" };
			}
		})();
		this._recallBuildPromise = buildPromise;
		try {
			await buildPromise;
		} finally {
			this._recallBuildPromise = undefined;
		}
		return this._recallCache?.rendered || undefined;
	}

	/**
	 * Build the per-turn memory recall transform. Returns the message array
	 * with a single `customType: "memory-recall"` entry inserted before the
	 * latest user message when the active provider returns hits, otherwise
	 * the input unchanged.
	 *
	 * Parallel with `RepomapInjector.buildTransform` — both seed off the same chat-state.
	 * Failures degrade silently: timeouts, missing provider, empty results all
	 * return `messages` untouched.
	 */
	async buildTransform(messages: AgentMessage[]): Promise<AgentMessage[]> {
		if (!this._enabled) return messages;

		const query = this._query(messages);
		const rendered = await this._getOrBuildRecall(query);
		const blocks: AgentMessage[] = [];

		// First-turn prelude: project-local MEMORY.md + a kickoff cavemem search
		// seeded by the cwd basename. Wires memory-bridge.composeStartupPrelude
		// which has been dead code since WS7 landed.
		if (!this._preludeInjected) {
			this._preludeInjected = true;
			const prelude = await this.buildSessionPrelude();
			if (prelude) {
				blocks.push({
					role: "custom",
					customType: "memory-prelude",
					content: prelude,
					display: false,
					timestamp: Date.now(),
				});
			}
		}

		if (rendered) {
			blocks.push({
				role: "custom",
				customType: "memory-recall",
				content: `<memory-recall>\nTop hits from prior caveman sessions and saved facts. Search seeded by current chat-state (no extra LLM call).\n\n${rendered}\n</memory-recall>`,
				display: false,
				timestamp: Date.now(),
			});
		}

		if (blocks.length === 0) return messages;

		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				return [...messages.slice(0, i), ...blocks, ...messages.slice(i)];
			}
		}
		return [...messages, ...blocks];
	}

	async buildSessionPrelude(): Promise<string | undefined> {
		try {
			const indexPath = join(this._cwd, ".cave", "memory", "MEMORY.md");
			let memoryIndex: string | undefined;
			if (existsSync(indexPath)) {
				const raw = readFileSync(indexPath, "utf-8");
				memoryIndex = raw.split("\n").slice(0, 200).join("\n");
			}
			let cavememSnippet: string | undefined;
			const provider = await this.getProvider();
			if (provider) {
				const hits = await this._withTimeout(
					provider.search(basename(this._cwd), { limit: 5 }),
					this._timeoutMs,
					[] as memoryNs.MemoryHit[],
				);
				if (hits.length > 0) {
					cavememSnippet = memoryNs.formatPrelude(hits);
				}
			}
			return composeStartupPrelude({ memoryIndex, cavememSnippet });
		} catch (err) {
			console.warn(`[cave/memory] prelude failed: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	}
}
