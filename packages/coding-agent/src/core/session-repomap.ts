/**
 * RepomapInjector — per-session repomap auto-injection (Gap 1).
 *
 * Extracted verbatim from `agent-session.ts` (god-file decomposition #16,
 * stage 1). Owns the repomap chat-state (added/mentioned files), the rendered
 * map cache + single-flight build, and the per-turn transform that injects a
 * PageRank-ranked repository map before the latest user message.
 *
 * Behavior-preserving move: the logic, caching, single-flight, and message
 * insertion are unchanged from the original AgentSession methods. AgentSession
 * keeps a `_repomapInjector` instance and delegates its public repomap methods
 * to it; the `transformContext` chain calls `buildTransform(...)`.
 */

import { basename, resolve } from "node:path";
import type { AgentMessage } from "@juliusbrussee/caveman-agent";

export class RepomapInjector {
	private readonly _cwd: string;
	private _enabled = true;
	private _addedFiles = new Set<string>();
	private _mentionedFiles = new Set<string>();
	private _cache: { hash: string; rendered: string } | undefined;
	private _buildPromise: Promise<void> | undefined;

	constructor(opts: { cwd: string }) {
		this._cwd = opts.cwd;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		if (!enabled) this._cache = undefined;
	}

	/** Mark a file as added to chat-state (PageRank weight 10×). */
	add(absPath: string): void {
		this._mentionedFiles.delete(absPath);
		this._addedFiles.add(absPath);
		this._cache = undefined;
	}

	/** Mark a file as mentioned (PageRank weight 0.5×). */
	mention(absPath: string): void {
		if (this._addedFiles.has(absPath)) return;
		this._mentionedFiles.add(absPath);
		this._cache = undefined;
	}

	updateFromTool(toolName: string, args: unknown): void {
		if (!this._enabled) return;
		const path = (args as { path?: string } | undefined)?.path;
		if (!path) return;
		const abs = resolve(this._cwd, path);
		if (toolName === "edit" || toolName === "write") {
			this.add(abs);
		} else if (toolName === "read") {
			this.mention(abs);
		}
	}

	scanUserMessage(text: string): void {
		// Conservative regex: relative paths with at least one slash and a known
		// source-file extension. Avoids matching arbitrary words.
		const re =
			/(?<![\w/])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cc|cpp|rb|php))(?![\w])/g;
		for (const match of text.matchAll(re)) {
			const abs = resolve(this._cwd, match[1]);
			this.mention(abs);
		}
	}

	/**
	 * Basenames of the most-recent added + mentioned files (last `n`). Used by
	 * AgentSession's memory query to seed retrieval with in-chat file names.
	 */
	recentFileBasenames(n: number): string[] {
		return [...this._addedFiles, ...this._mentionedFiles].slice(-n).map((p) => basename(p));
	}

	private _hash(): string {
		const added = [...this._addedFiles].sort().join("|");
		const mentioned = [...this._mentionedFiles].sort().join("|");
		return `${added}::${mentioned}`;
	}

	private async _getOrBuild(): Promise<string | undefined> {
		const hash = this._hash();
		if (this._cache?.hash === hash) return this._cache.rendered;

		// Single-flight: if a build is already in progress, wait for it.
		if (this._buildPromise) {
			await this._buildPromise;
			if (this._cache?.hash === hash) return this._cache.rendered;
		}

		const buildPromise = this._build(hash);
		this._buildPromise = buildPromise.then(
			() => undefined,
			() => undefined,
		);
		try {
			return await buildPromise;
		} finally {
			this._buildPromise = undefined;
		}
	}

	private async _build(hash: string): Promise<string | undefined> {
		try {
			const { collectSourceFiles } = await import("./slash-commands/repomap.js");
			const { repomap: repomapNs } = await import("@juliusbrussee/caveman-agent");
			const { buildRepomap, dynamicMapTokens } = repomapNs;

			const files = collectSourceFiles(this._cwd);
			if (files.length === 0) {
				this._cache = { hash, rendered: "" };
				return "";
			}
			const tokenBudget = dynamicMapTokens({ hasFilesInChat: this._addedFiles.size > 0 });
			const result = await buildRepomap({
				files,
				tokenBudget,
				workdir: this._cwd,
				chatState: {
					addedFiles: [...this._addedFiles],
					mentionedFiles: [...this._mentionedFiles],
				},
			});
			this._cache = { hash, rendered: result.rendered };
			return result.rendered;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[cave/repomap] build failed: ${message}`);
			return undefined;
		}
	}

	async buildTransform(messages: AgentMessage[]): Promise<AgentMessage[]> {
		if (!this._enabled) return messages;

		// Mine the most recent user message for file path mentions.
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role === "user") {
				const text = Array.isArray(m.content)
					? m.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n")
					: typeof m.content === "string"
						? m.content
						: "";
				if (text) this.scanUserMessage(text);
				break;
			}
		}

		const rendered = await this._getOrBuild();
		if (!rendered) return messages;

		const repomapMessage: AgentMessage = {
			role: "custom",
			customType: "repomap",
			content: `<repomap>\nThe following is a PageRank-ranked map of repository symbols, refreshed each turn. Use it to discover relevant files before you read them.\n\n${rendered}\n</repomap>`,
			display: false,
			timestamp: Date.now(),
		};

		// Inject just before the latest user message so the model reads the map
		// as antecedent context, not a follow-up reply.
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				return [...messages.slice(0, i), repomapMessage, ...messages.slice(i)];
			}
		}
		return [...messages, repomapMessage];
	}
}
