/**
 * Cave compression pipeline (#16 stage 4).
 *
 * Two compression stages share a single LLMLingua-2 instance and one bytes-led
 * SavingsTracker:
 *
 *   1. **afterToolCall** — read-dedup + (ML or rule-based) tool-result
 *      compression, run on EVERY tool result before it lands in the message
 *      log. Books savings under `dedup` (read short-circuit) or `compression`
 *      (net byte delta after the cave pipeline).
 *   2. **softCompactTransform** — proactive, idempotent LLMLingua pass over
 *      OLDER toolResult messages once context usage crosses
 *      `softThreshold`. Books savings under `compaction`. Re-runs are
 *      no-ops via `_softCompressedTimestamps`.
 *
 * Extracted from agent-session.ts. Behavior preserved verbatim — same
 * thresholds, same gates, same savings buckets, same ordering. The pipeline
 * does NOT call extension hooks (`tool_result`); that fan-out stays in
 * `AgentSession.afterToolCall` so this module has zero coupling to the
 * extension runner.
 */

import type { AgentMessage } from "@zhachory1/mewrite-agent";
import { LLMLinguaMiddleware } from "@zhachory1/mewrite-agent";
import { applyStructuredCompressionToContentBlocks } from "./cave-structured-compression.js";
import {
	applyToolBudgetToContentBlocks,
	collapseBlankLines,
	compressCaveToolContentBlocks,
	ReadDeduplicationCache,
	stripAnsi,
} from "./cave-tool-compression.js";
import { estimateContextTokens } from "./compaction/compaction.js";
import type { SavingsTracker } from "./savings-tracker.js";

/**
 * Minimum structural shape the compression pipeline operates on.
 *
 * The agent's actual content union is `(TextContent | ImageContent)[]`, which
 * is STRUCTURALLY narrower than `ContentBlock` (`TextContent.type` is the
 * literal `"text"`, not `string`; neither variant has an index signature).
 * We use `ContentBlock` as the pipeline's input/output type rather than threading
 * generics through to the strict union because TypeScript's variance rules make
 * `B extends ContentBlock` unsatisfiable for `TextContent | ImageContent`.
 *
 * The caller (`AgentSession.afterToolCall`) casts between the two at the
 * boundary. The cast is SOUND in this direction because:
 *   - Dedup: we return a single `{type: "text", text: stub}` block, which
 *     trivially conforms to `TextContent`.
 *   - Compression: we only ever (a) return the original block reference
 *     unchanged, or (b) return `{...block, text: <new string>}` — spreading
 *     preserves the block's narrow type and only mutates `.text` which is
 *     already `string` on `TextContent`. Image blocks pass through untouched.
 * No block kind is ever invented; no field is ever stripped.
 */
export type ContentBlock = { type: string; text?: string; [key: string]: unknown };

export interface CompressionPipelineSettings {
	/** Whether ML (LLMLingua-2 ONNX) compression is enabled. */
	getCaveModeMLCompression(): boolean;
	/** Whether caveman mode is on at all (gates soft compaction). */
	getCaveModeEnabled(): boolean;
}

export interface CompressionPipelineOptions {
	/** Fraction of the context window above which soft compaction kicks in. */
	softThreshold?: number;
	/** Number of trailing assistant-turn-equivalents protected from soft compaction. */
	softRecencyWindow?: number;
}

export interface DedupResult {
	/** New content blocks if dedup applied; undefined to fall through to compression. */
	stubContent?: ContentBlock[];
	/** Byte length of the original full text (used by the savings denominator). */
	fullBytes: number;
}

export class CompressionPipeline {
	private _llmlingua: LLMLinguaMiddleware | null = null;
	private readonly _readDedup = new ReadDeduplicationCache();
	private readonly _softCompressedTimestamps = new Set<number>();

	readonly softThreshold: number;
	readonly softRecencyWindow: number;

	constructor(
		private readonly settings: CompressionPipelineSettings,
		private readonly savings: SavingsTracker,
		options: CompressionPipelineOptions = {},
	) {
		this.softThreshold = options.softThreshold ?? 0.7;
		this.softRecencyWindow = options.softRecencyWindow ?? 5;
	}

	/** Pre-existing read-dedup cache, exposed for tests/diagnostics. */
	get readDeduplicationCache(): ReadDeduplicationCache {
		return this._readDedup;
	}

	/**
	 * Try to dedup a `read` tool result against prior reads of the same path.
	 * Returns a stub-content payload + full byte count when applied; returns
	 * `{ stubContent: undefined, fullBytes }` when no dedup happened so the
	 * caller can still book the denominator.
	 *
	 * Books savings: when dedup applies, records `tool_output` (fullBytes) and
	 * a `dedup` saving for the delta. Mirrors the agent-session call site.
	 */
	tryReadDedup(filePath: string, contentBlocks: readonly { type: string; text?: string }[]): DedupResult {
		const fullText = contentBlocks
			.filter((b) => b.type === "text" && typeof b.text === "string")
			.map((b) => b.text as string)
			.join("");
		const stub = this._readDedup.checkRead(filePath, fullText);
		if (!stub) {
			return { fullBytes: Buffer.byteLength(fullText, "utf8") };
		}
		const fullBytes = Buffer.byteLength(fullText, "utf8");
		this.savings.recordToolOutput(fullBytes);
		this.savings.recordSaving("dedup", fullBytes - Buffer.byteLength(stub, "utf8"));
		return {
			stubContent: [{ type: "text", text: stub }],
			fullBytes,
		};
	}

	/** Drop cached read on write/edit so the next read re-fingerprints. */
	invalidateDedup(filePath: string): void {
		this._readDedup.invalidate(filePath);
	}

	/**
	 * Compress a tool result's text blocks. Mirrors the agent-session pipeline
	 * exactly: ML pass (when settings enable it) THEN rule-based pass (always).
	 * Returns the new content blocks; callers compare reference equality if
	 * they need to detect a no-op.
	 *
	 * Does NOT book any savings — the caller computes before/after via
	 * `sumTextLen` and books a single `compression` delta to keep DD §10.1's
	 * "one net delta per tool result" invariant.
	 */
	async compressToolResult(toolName: string, args: unknown, content: ContentBlock[]): Promise<ContentBlock[]> {
		let processed = content;

		if (this.settings.getCaveModeMLCompression() && toolName !== "task" && toolName !== "agent") {
			// ML compression (LLMLingua-2 ONNX) — runs INSTEAD of rule-based stages
			// to avoid compounding and to let BERT see original text structure.
			try {
				if (!this._llmlingua) {
					this._llmlingua = new LLMLinguaMiddleware(true);
				}
				const mlResults = await Promise.all(
					processed.map(async (block) => {
						if (block.type !== "text" || typeof block.text !== "string") return block;
						const r = await this._llmlingua!.compressAsync(block.text, {
							targetRatio: 0.5,
							activationThreshold: 4000,
						});
						return r.compressed ? { ...block, text: r.bytes } : block;
					}),
				);
				processed = mlResults;
			} catch {
				// ML failed — fall through to rule-based pipeline.
				processed = content;
			}
		}

		// Rule-based compression (always runs: as primary when ML disabled, as
		// safety net when ML enabled).
		try {
			if (toolName === "task" || toolName === "agent") {
				processed = processed.map((block) => {
					if (block.type !== "text" || typeof block.text !== "string") return block;
					return { ...block, text: collapseBlankLines(stripAnsi(block.text)) };
				}) as ContentBlock[];
			} else {
				processed = applyToolBudgetToContentBlocks(processed, toolName) as ContentBlock[];
				const commandHint = toolName === "bash" ? (args as { command?: string }).command : undefined;
				processed = applyStructuredCompressionToContentBlocks(processed, toolName, commandHint) as ContentBlock[];
				processed = compressCaveToolContentBlocks(processed) as ContentBlock[];
			}
		} catch {
			processed = content;
		}

		return processed;
	}

	/**
	 * Soft compaction: proactive LLMLingua pass over OLDER toolResult messages
	 * once context usage crosses `softThreshold`. Re-runs are no-ops via the
	 * per-timestamp memo. Books `compaction` savings per compressed message.
	 *
	 * Caller passes the model's contextWindow; we no-op for zero windows.
	 */
	async softCompactTransform(messages: AgentMessage[], contextWindow: number): Promise<AgentMessage[]> {
		// Same toggle as the existing in-line tool-result compression. If the
		// user has cave-mode ML compression off, leave the messages alone.
		if (!this.settings.getCaveModeEnabled()) return messages;
		if (!this.settings.getCaveModeMLCompression()) return messages;

		if (contextWindow <= 0) return messages;
		const estimate = estimateContextTokens(messages);
		if (estimate.tokens / contextWindow < this.softThreshold) return messages;

		// Identify protected suffix: messages within the last N turns. A "turn"
		// here = one assistant message + its tool results. We protect by counting
		// from the end and stopping after we've seen N assistant messages.
		let assistantSeen = 0;
		let firstProtectedIndex = messages.length;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "assistant") {
				assistantSeen += 1;
				if (assistantSeen >= this.softRecencyWindow) {
					firstProtectedIndex = i;
					break;
				}
			}
		}

		if (!this._llmlingua) {
			this._llmlingua = new LLMLinguaMiddleware(true);
		}

		const transformed = await Promise.all(
			messages.map(async (m, idx) => {
				if (idx >= firstProtectedIndex) return m;
				if (m.role !== "toolResult") return m;
				if (m.toolName === "task" || m.toolName === "agent") return m;
				if (this._softCompressedTimestamps.has(m.timestamp)) return m;

				try {
					const compressedContent = await Promise.all(
						(m.content as ContentBlock[]).map(async (block) => {
							if (block.type !== "text" || typeof block.text !== "string") return block;
							const inLen = Buffer.byteLength(block.text, "utf8");
							const r = await this._llmlingua!.compressAsync(block.text, {
								targetRatio: 0.5,
								activationThreshold: 4000,
							});
							if (r.compressed) {
								// DD §10.2: soft-compaction is disjoint from inline compression
								// (operates on stored post-inline text) and idempotent via
								// `_softCompressedTimestamps` — book once per compressed message.
								this.savings.recordSaving("compaction", inLen - Buffer.byteLength(r.bytes, "utf8"));
								return { ...block, text: r.bytes };
							}
							return block;
						}),
					);
					this._softCompressedTimestamps.add(m.timestamp);
					return { ...m, content: compressedContent } as AgentMessage;
				} catch {
					// Compression is advisory; skip on error.
					return m;
				}
			}),
		);
		return transformed;
	}
}

/**
 * Sum of UTF-8 byte lengths across the text blocks in a content array.
 * Mirrors AgentSession's pre-existing helper used to size the savings
 * denominator. Exported so the caller can book the single net delta around
 * `compressToolResult`.
 */
export function sumTextLen(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	let total = 0;
	for (const block of content as Array<{ type?: string; text?: unknown }>) {
		if (block && block.type === "text" && typeof block.text === "string") {
			total += Buffer.byteLength(block.text, "utf8");
		}
	}
	return total;
}
