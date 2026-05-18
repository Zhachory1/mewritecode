/**
 * `/memory` slash command — list/search/save/forget/export/consolidate/sync (WS7).
 *
 * Subcommands (mirrors the WS7 deliverable):
 *   /memory                       Show provider, availability, and basic stats.
 *   /memory show                  Alias of the default.
 *   /memory search <query>        Run cavemem search and pretty-print hits.
 *   /memory save <text...>        Append a fact to memory (kind:fact).
 *   /memory forget <id> [<id>...] Soft-delete by id.
 *   /memory export <path>         Write a JSONL dump of memory.
 *   /memory consolidate           Run the episodic→semantic pass.
 *   /memory sync --from claude    One-shot import from ~/.claude/projects/<slug>/memory/.
 *   /memory off                   Disable memory writes for the session.
 *   /memory on                    Re-enable.
 *   /memory config                Print the active configuration.
 *
 * The handler is a pure dispatcher — it never touches the TUI directly. The
 * caller (interactive-mode / print-mode) feeds in a MemoryProvider built from
 * settings and prints the returned lines.
 */

import { resolve } from "node:path";
import type { memory as memoryNs } from "@caveman-code/agent";
import { composeStartupPrelude, importFromClaudeCode, locateClaudeMemory, readMemoryIndex } from "../memory-bridge.js";

type MemoryProvider = memoryNs.MemoryProvider;

export interface MemorySlashContext {
	cwd: string;
	provider: MemoryProvider;
	enabled: boolean;
	/** Persisted toggle setter — wired from settings-manager. */
	setEnabled?: (next: boolean) => void;
	/** Optional consolidation extractor (LLM call). When omitted we just cluster. */
	extractor?: memoryNs.SemanticExtractor;
}

export interface MemorySlashResult {
	lines: string[];
	errors: number;
}

function ok(...lines: string[]): MemorySlashResult {
	return { lines, errors: 0 };
}
function fail(...lines: string[]): MemorySlashResult {
	return { lines, errors: 1 };
}

export function parseMemorySlash(line: string): { verb: string; args: string[]; rest: string } {
	const trimmed = line.replace(/^\/memory\s*/, "").trim();
	if (trimmed.length === 0) return { verb: "show", args: [], rest: "" };
	const [verb, ...rest] = trimmed.split(/\s+/);
	return { verb, args: rest, rest: trimmed.slice(verb.length).trim() };
}

export async function runMemorySlashCommand(line: string, ctx: MemorySlashContext): Promise<MemorySlashResult> {
	const { verb, args, rest } = parseMemorySlash(line);
	switch (verb) {
		case "":
		case "show":
		case "status":
			return runShow(ctx);
		case "search":
			return runSearch(rest, ctx);
		case "save":
			return runSave(rest, ctx);
		case "forget":
			return runForget(args, ctx);
		case "export":
			return runExport(args, ctx);
		case "consolidate":
			return runConsolidate(ctx);
		case "sync":
			return runSync(args, ctx);
		case "off":
			ctx.setEnabled?.(false);
			return ok("memory writes disabled for this session");
		case "on":
			ctx.setEnabled?.(true);
			return ok("memory writes enabled");
		case "config":
			return runConfig(ctx);
		case "help":
		case "-h":
		case "--help":
			return ok(formatHelp());
		default:
			return fail(`Unknown /memory subcommand: ${verb}`, formatHelp());
	}
}

function formatHelp(): string {
	return [
		"/memory — cavemem-backed memory layer",
		"",
		"  /memory show                       Show provider + status",
		"  /memory search <query>             Search memory (top-10 hits)",
		"  /memory save <text>                Save a fact (kind=fact)",
		"  /memory forget <id> [<id>...]      Soft-delete by id",
		"  /memory export <path>              Write JSONL dump",
		"  /memory consolidate                Run episodic→semantic pass",
		"  /memory sync --from claude         Import Claude Code MEMORY.md",
		"  /memory off | on                   Disable / re-enable for session",
		"  /memory config                     Print active configuration",
	].join("\n");
}

async function runShow(ctx: MemorySlashContext): Promise<MemorySlashResult> {
	const lines: string[] = [];
	const available = await ctx.provider.isAvailable().catch(() => false);
	lines.push(`provider: ${ctx.provider.label}`);
	lines.push(`available: ${available ? "yes" : "no"}`);
	lines.push(`enabled: ${ctx.enabled ? "yes" : "no (writes off)"}`);
	if (available) {
		try {
			const sessions = await ctx.provider.listSessions({ limit: 1 });
			if (sessions.length > 0) {
				const s = sessions[0];
				lines.push(`last session: ${s.id}${s.started_at ? ` (${s.started_at})` : ""}`);
			}
		} catch (err) {
			lines.push(`note: listSessions failed — ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const claude = locateClaudeMemory(ctx.cwd);
	lines.push(`claude bridge: ${claude.exists ? `found ${claude.indexFile}` : "no MEMORY.md found"}`);
	return ok(...lines);
}

async function runSearch(query: string, ctx: MemorySlashContext): Promise<MemorySlashResult> {
	if (!query) return fail("Usage: /memory search <query>");
	const hits = await ctx.provider.search(query, { limit: 10 }).catch((err) => {
		throw err instanceof Error ? err : new Error(String(err));
	});
	if (hits.length === 0) return ok(`no hits for "${query}"`);
	const lines = [`top ${hits.length} hits for "${query}":`];
	for (const h of hits) {
		const tag = h.kind ? `[${h.kind}]` : "[obs]";
		const preview = (h.preview ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
		lines.push(`  ${tag} #${h.id} ${preview}`);
	}
	return ok(...lines);
}

async function runSave(text: string, ctx: MemorySlashContext): Promise<MemorySlashResult> {
	if (!text) return fail("Usage: /memory save <text>");
	if (!ctx.enabled) return fail("memory writes disabled (run /memory on first)");
	const id = await ctx.provider.save(text, "fact").catch((err) => {
		throw err instanceof Error ? err : new Error(String(err));
	});
	return ok(`saved${id !== undefined ? ` (id=${id})` : ""}`);
}

async function runForget(args: string[], ctx: MemorySlashContext): Promise<MemorySlashResult> {
	const ids = args.map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n));
	if (ids.length === 0) return fail("Usage: /memory forget <id> [<id>...]");
	const removed = await ctx.provider.forget(ids).catch(() => 0);
	return ok(`asked to forget ${ids.length} id(s); provider reported ${removed} removed`);
}

async function runExport(args: string[], ctx: MemorySlashContext): Promise<MemorySlashResult> {
	const path = args[0];
	if (!path) return fail("Usage: /memory export <path>");
	const abs = resolve(ctx.cwd, path);
	const r: { ok: boolean; bytes?: number; message?: string } = await ctx.provider.export(abs).catch((err) => ({
		ok: false,
		message: err instanceof Error ? err.message : String(err),
	}));
	if (!r.ok) return fail(`export failed: ${r.message ?? "(unknown error)"}`);
	return ok(`exported to ${abs}${r.bytes ? ` (${r.bytes} bytes)` : ""}`);
}

async function runConsolidate(ctx: MemorySlashContext): Promise<MemorySlashResult> {
	// Pull a recent timeline as the input set; cap at 50 to stay under the
	// extractor's typical context window.
	const sessions = await ctx.provider.listSessions({ limit: 1 }).catch(() => []);
	const sessionId = sessions[0]?.id;
	if (!sessionId) return fail("no recent sessions to consolidate");
	const timeline = await ctx.provider.timeline(sessionId, { limit: 50 }).catch(() => []);
	if (timeline.length === 0) return fail("timeline is empty for the latest session");
	const ids = timeline.map((t) => t.id).filter((n) => n > 0);
	const observations = await ctx.provider.getObservations(ids).catch(() => []);
	if (observations.length === 0) return fail("no observation bodies returned by provider");

	const { consolidate } = await import("@caveman-code/agent").then((m) => m.memory);
	const result = await consolidate(ctx.provider, observations, {
		extractor: ctx.extractor,
		minClusterSize: 2,
		maxClusters: 8,
	});

	const lines = [`consolidation: ${result.clusters.length} cluster(s)`];
	for (const c of result.clusters) {
		lines.push(`  topic="${c.topic}" obs=${c.observationIds.length}`);
	}
	if (ctx.extractor) {
		lines.push(`facts extracted: ${result.facts.length}; written: ${result.written}`);
	} else {
		lines.push("(no extractor configured — facts not written. Run with --extractor to extract semantic facts.)");
	}
	return ok(...lines);
}

async function runSync(args: string[], ctx: MemorySlashContext): Promise<MemorySlashResult> {
	const fromIdx = args.indexOf("--from");
	const source = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
	if (source !== "claude") {
		return fail("Usage: /memory sync --from claude");
	}
	const loc = locateClaudeMemory(ctx.cwd);
	if (!loc.exists) return fail(`no Claude Code MEMORY.md at ${loc.indexFile}`);
	const result = await importFromClaudeCode(loc, ctx.provider, {
		dryRun: args.includes("--dry-run"),
	});
	const lines = [`source: ${loc.root}`, `imported: ${result.imported}`, `skipped: ${result.skipped}`];
	if (result.errors.length > 0) {
		lines.push("errors:");
		for (const e of result.errors) lines.push(`  - ${e}`);
		return { lines, errors: 1 };
	}
	return ok(...lines);
}

function runConfig(ctx: MemorySlashContext): MemorySlashResult {
	const claude = locateClaudeMemory(ctx.cwd);
	const lines = [
		`provider: ${ctx.provider.label}`,
		`enabled: ${ctx.enabled}`,
		`cwd: ${ctx.cwd}`,
		`claude bridge dir: ${claude.exists ? claude.root : "(none)"}`,
	];
	return ok(...lines);
}

/**
 * Helper used by the session-start prelude builder.
 *
 * Composes a system-reminder block from (a) the first 200 lines of Claude's
 * MEMORY.md, and (b) a compact list of cavemem search hits matching the
 * task summary. Both inputs are optional.
 */
export async function buildSessionStartPrelude(args: {
	cwd: string;
	provider: MemoryProvider;
	taskSummary?: string;
	maxChars?: number;
}): Promise<string> {
	const loc = locateClaudeMemory(args.cwd);
	const memoryIndex = readMemoryIndex(loc, { lines: 200 });

	let cavememSnippet: string | undefined;
	if (args.taskSummary?.trim()) {
		try {
			const hits = await args.provider.search(args.taskSummary, { limit: 5 });
			const { formatPrelude } = await import("@caveman-code/agent").then((m) => m.memory);
			cavememSnippet = formatPrelude(hits, { max: 5 });
		} catch {
			cavememSnippet = undefined;
		}
	}

	return composeStartupPrelude({ memoryIndex, cavememSnippet, maxChars: args.maxChars });
}
