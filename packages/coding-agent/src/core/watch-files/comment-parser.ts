/*
 * WS18 - Watch-Files comment parser.
 *
 * Scans a file's content for configured comment markers across multiple languages.
 */

import { WATCH_FIRE_MARKER, WATCH_MARKER, WATCH_QA_MARKER } from "../../config.js";

export type CommentKind = "fire" | "qa" | "context";

/** A single mewrite comment found in a file. */
export interface MewriteComment {
	/** Line number (1-indexed). */
	line: number;
	/** Marker kind. */
	kind: CommentKind;
	/** Text that follows the marker (trimmed), may be empty string. */
	text: string;
	/** The full raw line content. */
	rawLine: string;
}

/**
 * Language → comment prefix table.
 * Each entry maps a file extension to the set of line-comment prefixes it supports.
 */
const COMMENT_PREFIXES: Record<string, string[]> = {
	// C-style
	ts: ["//", "/*"],
	tsx: ["//", "/*"],
	js: ["//", "/*"],
	jsx: ["//", "/*"],
	mjs: ["//", "/*"],
	cjs: ["//", "/*"],
	go: ["//"],
	rs: ["//"],
	c: ["//", "/*"],
	cpp: ["//", "/*"],
	cc: ["//", "/*"],
	h: ["//", "/*"],
	java: ["//", "/*"],
	kt: ["//", "/*"],
	swift: ["//"],
	// Hash-style
	py: ["#"],
	rb: ["#"],
	sh: ["#"],
	bash: ["#"],
	zsh: ["#"],
	yml: ["#"],
	yaml: ["#"],
	toml: ["#"],
	r: ["#"],
	// Dash-style
	lua: ["--"],
	sql: ["--"],
	// PHP supports both
	php: ["//", "#", "/*"],
};

/** Default prefixes for unknown extensions. */
const DEFAULT_PREFIXES = ["//", "#"];

/** Get comment prefixes for a given file extension (without dot). */
export function getPrefixesForExt(ext: string): string[] {
	return COMMENT_PREFIXES[ext.toLowerCase()] ?? DEFAULT_PREFIXES;
}

/**
 * Parse the text after a watch marker to determine kind and payload.
 * Returns null if the marker is not a configured watch comment.
 */
function parseMarkerText(afterPrefix: string): { kind: CommentKind; text: string } | null {
	const trimmed = afterPrefix.trim();

	// Check for block-comment close (handles inline block marker style)
	const withoutBlockClose = trimmed.replace(/\s*\*\/\s*$/, "").trim();

	const toCheck = withoutBlockClose;

	if (toCheck.startsWith(WATCH_FIRE_MARKER)) {
		return { kind: "fire", text: toCheck.slice(WATCH_FIRE_MARKER.length).trim() };
	}
	if (toCheck.startsWith(WATCH_QA_MARKER)) {
		return { kind: "qa", text: toCheck.slice(WATCH_QA_MARKER.length).trim() };
	}
	// Must be exactly the marker or marker + space followed by context text (not fire or Q&A)
	if (toCheck === WATCH_MARKER || toCheck.startsWith(`${WATCH_MARKER} `)) {
		return { kind: "context", text: toCheck.slice(WATCH_MARKER.length).trim() };
	}

	return null;
}

/**
 * Parse all configured watch comments from file content.
 *
 * @param content — full file text
 * @param ext — file extension (without dot), used to determine comment prefixes
 */
export function parseMewriteComments(content: string, ext: string): MewriteComment[] {
	const prefixes = getPrefixesForExt(ext);
	const lines = content.split("\n");
	const results: MewriteComment[] = [];

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const trimmedLine = rawLine.trimStart();

		for (const prefix of prefixes) {
			if (!trimmedLine.startsWith(prefix)) continue;

			const afterPrefix = trimmedLine.slice(prefix.length);
			const parsed = parseMarkerText(afterPrefix);
			if (parsed) {
				results.push({
					line: i + 1,
					kind: parsed.kind,
					text: parsed.text,
					rawLine,
				});
			}
			break; // only match one prefix per line
		}
	}

	return results;
}

/**
 * Extract surrounding lines (±radius) around a given 1-indexed line number.
 * Returns an array of { lineNumber, content } objects.
 */
export function surroundingLines(
	content: string,
	centerLine: number,
	radius = 20,
): Array<{ lineNumber: number; content: string }> {
	const lines = content.split("\n");
	const start = Math.max(0, centerLine - 1 - radius);
	const end = Math.min(lines.length - 1, centerLine - 1 + radius);
	const result: Array<{ lineNumber: number; content: string }> = [];
	for (let i = start; i <= end; i++) {
		result.push({ lineNumber: i + 1, content: lines[i] });
	}
	return result;
}

/**
 * Remove a mewrite comment line from file content by 1-indexed line number.
 * Returns the modified content string.
 */
export function removeLine(content: string, lineNumber: number): string {
	const lines = content.split("\n");
	if (lineNumber < 1 || lineNumber > lines.length) return content;
	lines.splice(lineNumber - 1, 1);
	return lines.join("\n");
}
