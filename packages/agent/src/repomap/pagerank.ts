// T-061, T-062, T-065, T-069: deterministic PageRank over symbol reference graph.
//
// WS8 extension: chat-state personalization vector (Aider-style).
// Files explicitly added to chat + recently-mentioned files get a higher
// initial weight in the personalization vector. This is plain personalized
// PageRank — the (1-damping) restart distribution is no longer uniform but
// concentrated on chat-relevant files. Algorithm: Aider's `repomap.py`,
// vendored to TypeScript. Aider is Apache-2.0; cite in module header.

import type { SymbolGraph, SymbolNode } from "./symbol-graph.js";

export interface RankedSymbol {
	node: SymbolNode;
	score: number;
}

export interface PageRankOptions {
	damping?: number;
	iterations?: number;
	/** Convergence threshold (L1 norm). Default 1e-6. */
	epsilon?: number;
	/**
	 * WS8: personalization vector by file path. Files in this map get
	 * proportionally higher weight in the (1-damping) restart distribution.
	 *
	 * Suggested values from Aider:
	 *   - chat-added file (in current chat) → 10.0
	 *   - mentioned-but-not-added file      → 0.5
	 *   - everything else                   → 1.0 (implicit)
	 *
	 * Weights are normalized internally — only relative magnitude matters.
	 */
	personalization?: Map<string, number>;
}

/**
 * Run personalized PageRank to convergence.
 *
 * Convergence: stops at `iterations` iterations OR when the L1 norm
 * difference between successive rank vectors falls below `epsilon`,
 * whichever comes first. Aider uses ~50 iterations and `epsilon=1e-6`.
 *
 * Determinism: identical input ⇒ identical output, by construction.
 * Node ordering is sorted alphabetically by id; tie-breaks in the final
 * ranked list use (file, line, name).
 */
export function pagerank(graph: SymbolGraph, opts: PageRankOptions = {}): RankedSymbol[] {
	const damping = opts.damping ?? 0.85;
	const iterations = opts.iterations ?? 50;
	const epsilon = opts.epsilon ?? 1e-6;
	const nodeIds = [...graph.nodes.keys()].sort();
	const n = nodeIds.length;
	if (n === 0) return [];
	const idx = new Map<string, number>();
	for (let i = 0; i < nodeIds.length; i++) idx.set(nodeIds[i], i);
	const outgoing: number[][] = Array.from({ length: n }, () => []);
	const outDegree = new Array(n).fill(0);
	for (const edge of graph.edges) {
		const from = idx.get(edge.from);
		const to = idx.get(edge.to);
		if (from === undefined || to === undefined) continue;
		outgoing[from].push(to);
		outDegree[from]++;
	}

	// Build the personalization vector. If the caller supplied one, look up
	// each node's file in the map and use that weight; otherwise uniform.
	const personalization = new Array<number>(n);
	if (opts.personalization && opts.personalization.size > 0) {
		let total = 0;
		for (let i = 0; i < n; i++) {
			const node = graph.nodes.get(nodeIds[i])!;
			// Default weight 1.0 for files not in the personalization map.
			const w = opts.personalization.get(node.file) ?? 1.0;
			personalization[i] = w;
			total += w;
		}
		// Normalize so the personalization vector sums to 1.
		if (total > 0) {
			for (let i = 0; i < n; i++) personalization[i] /= total;
		} else {
			for (let i = 0; i < n; i++) personalization[i] = 1 / n;
		}
	} else {
		for (let i = 0; i < n; i++) personalization[i] = 1 / n;
	}

	let rank = new Array(n).fill(1 / n);
	for (let iter = 0; iter < iterations; iter++) {
		const next = new Array(n);
		// Restart distribution = (1 - damping) * personalization.
		for (let j = 0; j < n; j++) next[j] = (1 - damping) * personalization[j];
		for (let i = 0; i < n; i++) {
			if (outDegree[i] === 0) {
				// Dangling: distribute proportional to personalization vector
				// (Aider's choice — keeps mass on chat-relevant files).
				const mass = damping * rank[i];
				for (let j = 0; j < n; j++) next[j] += mass * personalization[j];
				continue;
			}
			const share = (damping * rank[i]) / outDegree[i];
			for (const j of outgoing[i]) next[j] += share;
		}
		// L1 convergence check
		let diff = 0;
		for (let i = 0; i < n; i++) diff += Math.abs(next[i] - rank[i]);
		rank = next;
		if (diff < epsilon) break;
	}
	const ranked: RankedSymbol[] = nodeIds.map((id, i) => ({
		node: graph.nodes.get(id)!,
		score: rank[i],
	}));
	// Deterministic ordering: score desc, then by (file, line, name) asc
	ranked.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		if (a.node.file !== b.node.file) return a.node.file.localeCompare(b.node.file);
		if (a.node.line !== b.node.line) return a.node.line - b.node.line;
		return a.node.name.localeCompare(b.node.name);
	});
	return ranked;
}

/** Select top-K symbols whose rendered budget fits `tokenBudget`.
 *  Drops lowest-rank first; never splits a symbol mid-body. */
export function selectWithinBudget(
	ranked: RankedSymbol[],
	tokenBudget: number,
	estimate: (sym: SymbolNode) => number,
): RankedSymbol[] {
	const out: RankedSymbol[] = [];
	let used = 0;
	for (const item of ranked) {
		const cost = estimate(item.node);
		if (used + cost > tokenBudget) break;
		out.push(item);
		used += cost;
	}
	return out;
}
