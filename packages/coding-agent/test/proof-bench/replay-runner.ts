/**
 * Replay runner — deterministic re-pipe of live session .jsonl files through
 * the compression stack with individual layers disabled. $0 cost (no API).
 *
 * For each (session, replay-config) pair it returns:
 *   tokensOriginal — raw tool-output tokens before any compression
 *   tokensReplay   — tokens after the F-cave-full pipeline with the config's
 *                    `disables` layers turned off
 *   deltaPct       — (replay − original) / original × 100
 *
 * Isolates layer contributions without consuming any tokens. Preflight can
 * publish per-layer attribution from `tokensReplay(noX) − tokensReplay(full)`.
 *
 * Compaction is treated separately: tool-result compression is the dominant
 * factor; compaction math is derived from session-replay-utils' compaction
 * events, not re-simulated here.
 */

import { readFileSync } from "node:fs";
import { compressStructuredOutput } from "../../src/core/cave-structured-compression.js";
import { compressCaveToolOutput, truncateWithToolBudget } from "../../src/core/cave-tool-compression.js";
import type { ReplayConfigId, ReplayLayer } from "./ablation-matrix.js";
import { REPLAY_CONFIGS } from "./ablation-matrix.js";

const CHARS_PER_TOKEN = 4;

function tokensOf(s: string): number {
	return Math.ceil(s.length / CHARS_PER_TOKEN);
}

export interface ReplayToolResult {
	toolName: string;
	toolCallId: string;
	content: string;
	/** Stable key used to detect re-reads of identical content for dedup replay. */
	fingerprint?: string;
}

export interface ReplayRow {
	config: ReplayConfigId;
	sessionPath: string;
	tokensOriginal: number;
	tokensReplay: number;
	deltaPct: number;
}

function extractToolResultsFromJsonl(sessionPath: string): ReplayToolResult[] {
	const content = readFileSync(sessionPath, "utf-8");
	const out: ReplayToolResult[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const e = entry as Record<string, unknown>;
		const msg = e.message as Record<string, unknown> | undefined;
		if (!msg || msg.role !== "toolResult") continue;

		const blocks = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
		const text = blocks
			.filter((b) => b.type === "text" && typeof b.text === "string")
			.map((b) => b.text as string)
			.join("\n");
		if (!text) continue;

		const toolName = typeof msg.toolName === "string" ? msg.toolName : "bash";
		const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
		const fp = `${text.length}:${text.slice(0, 256)}`;
		out.push({ toolName, toolCallId, content: text, fingerprint: fp });
	}
	return out;
}

/**
 * Local dedup state — mirrors the runtime ReadDeduplicationCache's observable
 * behavior (stub on repeat fingerprints) without depending on its private
 * fields. Using our own map here keeps the replay harness isolated from
 * refactors of the runtime class.
 */
class ReplayDedupMap {
	private seen = new Map<string, number>();

	lookup(fingerprint: string): number | undefined {
		return this.seen.get(fingerprint);
	}

	record(fingerprint: string): void {
		if (!this.seen.has(fingerprint)) {
			this.seen.set(fingerprint, this.seen.size + 1);
		}
	}
}

/**
 * Apply the full caveman compression pipeline with specific layers optionally
 * disabled. Returns a per-result string so callers can count tokens.
 */
function pipe(result: ReplayToolResult, disables: Set<ReplayLayer>, dedup: ReplayDedupMap | null): string {
	let text = result.content;
	if (!disables.has("dedup") && dedup && result.toolName === "read" && result.fingerprint) {
		const priorIndex = dedup.lookup(result.fingerprint);
		if (priorIndex !== undefined) {
			return `[File unchanged since read #${priorIndex}. Content identical to prior read.]`;
		}
		dedup.record(result.fingerprint);
	}
	if (!disables.has("flint")) {
		text = truncateWithToolBudget(text, result.toolName);
	}
	if (!disables.has("stone")) {
		text = compressStructuredOutput(text, result.toolName);
	}
	// ANSI/blank/500-line truncate is always-on in the runtime; mirror that
	// so the replay matches the shipped pipeline.
	text = compressCaveToolOutput(text);
	return text;
}

/**
 * Run an arbitrary layer-disable set against a session. Shared implementation
 * for both named replay configs and the synthetic "all-layers-on" baseline.
 */
function replayWithDisables(
	sessionPath: string,
	disables: Set<ReplayLayer>,
): { tokensOriginal: number; tokensReplay: number } {
	const results = extractToolResultsFromJsonl(sessionPath);
	let tokensOriginal = 0;
	let tokensReplay = 0;
	const dedup = new ReplayDedupMap();
	for (const r of results) {
		tokensOriginal += tokensOf(r.content);
		tokensReplay += tokensOf(pipe(r, disables, dedup));
	}
	return { tokensOriginal, tokensReplay };
}

export function replaySession(sessionPath: string, configId: ReplayConfigId): ReplayRow {
	const config = REPLAY_CONFIGS.find((c) => c.id === configId);
	if (!config) throw new Error(`Unknown replay config: ${configId}`);
	const { tokensOriginal, tokensReplay } = replayWithDisables(sessionPath, new Set(config.disables));
	const deltaPct = tokensOriginal === 0 ? 0 : ((tokensReplay - tokensOriginal) / tokensOriginal) * 100;
	return { config: configId, sessionPath, tokensOriginal, tokensReplay, deltaPct };
}

/**
 * Tokens for a session with every caveman layer on. Exposed so the reporter
 * can compute clean per-layer attribution as `tokensReplay(no-X) − baseline`
 * instead of `tokensReplay(no-X) − min(other-replay-configs)` (which has no
 * principled meaning).
 */
export interface ReplayBaselineRow {
	sessionPath: string;
	tokensOriginal: number;
	tokensAllLayersOn: number;
}

export function replayAllLayersOnBaseline(sessionPath: string): ReplayBaselineRow {
	const { tokensOriginal, tokensReplay } = replayWithDisables(sessionPath, new Set());
	return { sessionPath, tokensOriginal, tokensAllLayersOn: tokensReplay };
}

export function replayAll(sessionPaths: string[]): ReplayRow[] {
	const out: ReplayRow[] = [];
	for (const path of sessionPaths) {
		for (const c of REPLAY_CONFIGS) {
			out.push(replaySession(path, c.id));
		}
	}
	return out;
}

export function replayAllWithBaseline(sessionPaths: string[]): { rows: ReplayRow[]; baselines: ReplayBaselineRow[] } {
	return {
		rows: replayAll(sessionPaths),
		baselines: sessionPaths.map(replayAllLayersOnBaseline),
	};
}

// CLI entry: replay all session files passed as args, emit results.json-shaped rows.
if (import.meta.url === `file://${process.argv[1]}`) {
	const files = process.argv.slice(2);
	if (files.length === 0) {
		process.stderr.write("Usage: replay-runner.ts <session.jsonl> [more sessions...]\n");
		process.exit(2);
	}
	const rows = replayAll(files);
	process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}
