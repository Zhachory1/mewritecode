/**
 * WS8: high-level repomap builder.
 *
 * Ties together parsing, symbol-graph construction, personalized PageRank,
 * and rendering into a single entry point. Adds chat-state personalization
 * (added-files, mentioned-files) so the ranking reflects what the user is
 * actually working on, not just the global graph topology.
 */

import { type PageRankOptions, pagerank, type RankedSymbol, selectWithinBudget } from "./pagerank.js";
import { type ParsedFile, parseFileAsync } from "./parser.js";
import { estimateRenderTokens, type RepoMapStyle, renderRepomap } from "./render.js";
import { buildSymbolGraph, type SymbolGraph } from "./symbol-graph.js";

export interface ChatState {
	/**
	 * Files explicitly added to the chat (highest priority for personalization).
	 * Aider weight: 10.0
	 */
	addedFiles?: string[];
	/**
	 * Files mentioned in conversation but not added (medium priority).
	 * Aider weight: 0.5
	 */
	mentionedFiles?: string[];
	/**
	 * Custom weights per file. Overrides the implicit weights above.
	 */
	weights?: Map<string, number>;
}

export interface BuildRepomapInput {
	/** Files to consider for the map; pass everything you want analysed. */
	files: Array<{ file: string; source: string }>;
	/** Total budget for the rendered map, in approximate tokens. */
	tokenBudget: number;
	/** "caveman" (default) is denser; "full" emits prose signatures. */
	style?: RepoMapStyle;
	/** Workdir for relative-path rendering. */
	workdir?: string;
	/** Chat state for personalization. */
	chatState?: ChatState;
	/** PageRank options (damping, iterations, epsilon override). */
	pagerank?: PageRankOptions;
}

export interface BuildRepomapResult {
	rendered: string;
	graph: SymbolGraph;
	ranked: RankedSymbol[];
	selected: RankedSymbol[];
	usedTokens: number;
	parsed: ParsedFile[];
}

/**
 * Default Aider-style personalization weights.
 * Sourced from Aider's `repomap.py`: chat_files weight = 10, mentioned = 0.5.
 */
export const PERSONALIZATION_DEFAULTS = {
	added: 10.0,
	mentioned: 0.5,
	other: 1.0,
} as const;

export function personalizationFromChat(chat: ChatState | undefined): Map<string, number> {
	const map = new Map<string, number>();
	if (!chat) return map;
	for (const f of chat.addedFiles ?? []) map.set(f, PERSONALIZATION_DEFAULTS.added);
	for (const f of chat.mentionedFiles ?? []) {
		if (!map.has(f)) map.set(f, PERSONALIZATION_DEFAULTS.mentioned);
	}
	if (chat.weights) {
		for (const [file, w] of chat.weights) map.set(file, w);
	}
	return map;
}

/**
 * Build a complete repomap.
 *
 * Flow: parseAsync (tree-sitter→regex fallback) → buildSymbolGraph →
 * personalized PageRank → selectWithinBudget → renderRepomap.
 *
 * Determinism: identical input ⇒ identical output. PageRank stops at
 * convergence (epsilon=1e-6) or at the iteration cap (50), whichever first.
 */
export async function buildRepomap(input: BuildRepomapInput): Promise<BuildRepomapResult> {
	const style: RepoMapStyle = input.style ?? "caveman";
	const workdir = input.workdir ?? "";

	// 1. Parse every input file.
	const parsed: ParsedFile[] = [];
	const sources = new Map<string, string>();
	for (const { file, source } of input.files) {
		parsed.push(await parseFileAsync(file, source));
		sources.set(file, source);
	}

	// 2. Build the symbol graph.
	const graph = buildSymbolGraph(parsed, sources);

	// 3. Personalized PageRank.
	const personalization = personalizationFromChat(input.chatState);
	const ranked = pagerank(graph, {
		...input.pagerank,
		personalization: personalization.size > 0 ? personalization : undefined,
	});

	// 4. Budget selection.
	const selected = selectWithinBudget(ranked, input.tokenBudget, (sym) => estimateRenderTokens(sym, style));

	// 5. Render.
	const rendered = renderRepomap(selected, { style, workdir });
	const usedTokens = selected.reduce((s, r) => s + estimateRenderTokens(r.node, style), 0);

	return { rendered, graph, ranked, selected, usedTokens, parsed };
}

/**
 * Dynamically expand the token budget when the chat has no files added.
 *
 * Aider's heuristic: if the user hasn't pinned any files, the map is doing
 * 100% of the context-selection work, so spend more on it. With files
 * pinned, those bodies are in context already and the map is just a hint.
 *
 * Defaults: 1k tokens normally, 2k when no files in chat. Override either
 * via the `--map-tokens` flag.
 */
export function dynamicMapTokens(opts: {
	defaultBudget?: number;
	expandedBudget?: number;
	hasFilesInChat: boolean;
}): number {
	const def = opts.defaultBudget ?? 1024;
	const exp = opts.expandedBudget ?? 2048;
	return opts.hasFilesInChat ? def : exp;
}
