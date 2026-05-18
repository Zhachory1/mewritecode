/**
 * WS8: `/repomap` slash command.
 *
 * Subcommands:
 *   /repomap                 → render the current repomap with default budget
 *   /repomap show            → alias for `/repomap`
 *   /repomap stats           → show graph stats (nodes, edges, top symbols)
 *   /repomap budget <n>      → render with `n` tokens of budget
 *   /repomap add <file>      → add a file to chat-state personalization
 *   /repomap mention <file>  → mark a file as mentioned (lower weight)
 *   /repomap reset           → clear chat-state personalization
 *   /repomap help            → this text
 *
 * Self-contained handler so it can run from interactive mode, print mode,
 * or `cave repomap` CLI without re-importing the TUI stack.
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { repomap as repomapNs } from "@caveman-code/agent";

const { buildRepomap, dynamicMapTokens } = repomapNs;

export interface RepomapCommandResult {
	exitCode: number;
	output: string;
}

export interface RepomapChatState {
	addedFiles: string[];
	mentionedFiles: string[];
}

export function emptyChatState(): RepomapChatState {
	return { addedFiles: [], mentionedFiles: [] };
}

export interface RepomapCommandIO {
	cwd: string;
	chatState?: RepomapChatState;
	/** Override budget (otherwise dynamic based on chatState). */
	mapTokens?: number;
}

/** Walk the working dir and collect candidate source files. */
export function collectSourceFiles(
	cwd: string,
	opts: { maxFiles?: number; maxBytes?: number } = {},
): Array<{ file: string; source: string }> {
	const maxFiles = opts.maxFiles ?? 500;
	const maxBytes = opts.maxBytes ?? 256 * 1024;
	const exts = new Set([
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs",
		".py",
		".go",
		".rs",
		".java",
		".c",
		".h",
		".cc",
		".cpp",
		".rb",
		".php",
	]);
	const ignore = new Set([
		"node_modules",
		"dist",
		"build",
		".git",
		".next",
		".cache",
		".venv",
		"venv",
		"__pycache__",
		"target",
		"out",
		".cave",
	]);
	const out: Array<{ file: string; source: string }> = [];

	function walk(dir: string): void {
		if (out.length >= maxFiles) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= maxFiles) return;
			if (ignore.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				const dot = entry.name.lastIndexOf(".");
				if (dot === -1) continue;
				const ext = entry.name.slice(dot).toLowerCase();
				if (!exts.has(ext)) continue;
				try {
					const stat = statSync(full);
					if (stat.size > maxBytes) continue;
					const source = readFileSync(full, "utf-8");
					out.push({ file: full, source });
				} catch {
					// skip unreadable files
				}
			}
		}
	}

	walk(cwd);
	return out;
}

export async function runRepomapCommand(args: string, io: RepomapCommandIO): Promise<RepomapCommandResult> {
	const argv = args.trim().split(/\s+/).filter(Boolean);
	const sub = argv[0] ?? "show";
	const chatState = io.chatState ?? emptyChatState();

	switch (sub) {
		case "show":
		case "":
			return showMap(io, chatState);
		case "stats":
			return showStats(io, chatState);
		case "budget":
			return showMap({ ...io, mapTokens: parseInt(argv[1] ?? "0", 10) || io.mapTokens }, chatState);
		case "add":
			return addFile(argv[1], io, chatState, "added");
		case "mention":
			return addFile(argv[1], io, chatState, "mentioned");
		case "reset":
			chatState.addedFiles.length = 0;
			chatState.mentionedFiles.length = 0;
			return ok("repomap: chat-state reset.");
		default:
			return ok(formatHelp());
	}
}

function ok(output: string): RepomapCommandResult {
	return { exitCode: 0, output };
}
function err(output: string): RepomapCommandResult {
	return { exitCode: 1, output };
}

function formatHelp(): string {
	return [
		"/repomap — Aider-style PageRank repo map (WS8)",
		"",
		"Usage:",
		"  /repomap                 Show the map with default budget",
		"  /repomap stats           Show graph stats (nodes, edges, top symbols)",
		"  /repomap budget <N>      Show the map with N tokens of budget",
		"  /repomap add <file>      Mark a file as added-to-chat (weight 10×)",
		"  /repomap mention <file>  Mark a file as mentioned (weight 0.5×)",
		"  /repomap reset           Clear chat-state personalization",
		"",
		"--map-tokens=<N>           CLI flag — override the default budget (1024)",
		"--edit-format=<fmt>        CLI flag — see /architect or `cave debug edit-formats`",
	].join("\n");
}

async function showMap(io: RepomapCommandIO, chatState: RepomapChatState): Promise<RepomapCommandResult> {
	const files = collectSourceFiles(io.cwd);
	if (files.length === 0) {
		return err(`repomap: no source files found under ${io.cwd}`);
	}
	const tokenBudget = io.mapTokens ?? dynamicMapTokens({ hasFilesInChat: chatState.addedFiles.length > 0 });
	const result = await buildRepomap({
		files,
		tokenBudget,
		workdir: io.cwd,
		chatState: {
			addedFiles: chatState.addedFiles.map((f) => resolve(io.cwd, f)),
			mentionedFiles: chatState.mentionedFiles.map((f) => resolve(io.cwd, f)),
		},
	});

	const lines: string[] = [];
	lines.push(`repomap (style=caveman, budget=${tokenBudget}t, used~${result.usedTokens}t):`);
	lines.push(`  files: ${files.length}  symbols: ${result.graph.nodes.size}  edges: ${result.graph.edges.length}`);
	if (chatState.addedFiles.length || chatState.mentionedFiles.length) {
		lines.push(
			`  personalization: added=${chatState.addedFiles.length} mentioned=${chatState.mentionedFiles.length}`,
		);
	}
	lines.push("");
	lines.push(result.rendered);
	return ok(lines.join("\n"));
}

async function showStats(io: RepomapCommandIO, chatState: RepomapChatState): Promise<RepomapCommandResult> {
	const files = collectSourceFiles(io.cwd);
	if (files.length === 0) return err(`repomap: no source files found under ${io.cwd}`);
	const result = await buildRepomap({
		files,
		tokenBudget: 1024 * 1024, // generous so we can see the full ranked list
		workdir: io.cwd,
		chatState: {
			addedFiles: chatState.addedFiles.map((f) => resolve(io.cwd, f)),
			mentionedFiles: chatState.mentionedFiles.map((f) => resolve(io.cwd, f)),
		},
	});
	const top = result.ranked.slice(0, 20);
	const lines = [
		`repomap stats:`,
		`  files=${files.length} nodes=${result.graph.nodes.size} edges=${result.graph.edges.length}`,
		`  added=${chatState.addedFiles.length} mentioned=${chatState.mentionedFiles.length}`,
		"",
		"Top 20 by PageRank:",
	];
	for (const r of top) {
		const rel = relative(io.cwd, r.node.file);
		lines.push(`  ${r.score.toFixed(6)}  ${r.node.kind} ${r.node.name} @ ${rel}:${r.node.line}`);
	}
	return ok(lines.join("\n"));
}

function addFile(
	path: string | undefined,
	io: RepomapCommandIO,
	chatState: RepomapChatState,
	kind: "added" | "mentioned",
): RepomapCommandResult {
	if (!path) return err(`Usage: /repomap ${kind === "added" ? "add" : "mention"} <file>`);
	const abs = resolve(io.cwd, path);
	if (!existsSync(abs)) return err(`repomap: file not found: ${path}`);
	const target = kind === "added" ? chatState.addedFiles : chatState.mentionedFiles;
	if (!target.includes(path)) target.push(path);
	return ok(
		`repomap: ${kind} ${path} (added=${chatState.addedFiles.length}, mentioned=${chatState.mentionedFiles.length})`,
	);
}
