/*
 * WS18 - Watch-Files comment parser.
 *
 * Scans a file's content for cave comment markers across multiple languages:
 *   "// cave!"  - fire trigger (js/ts/go/rust/c/cpp/java)
 *   "# cave!"   - fire trigger (py/rb/sh)
 *   "-- cave!"  - fire trigger (lua/sql)
 *   "cave?"     - Q&A trigger (read-only)
 *   "cave"      - accumulate context (no suffix)
 */

export type CommentKind = "fire" | "qa" | "context";

/** A single cave comment found in a file. */
export interface CaveComment {
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
 * Parse the text after a cave marker to determine kind and payload.
 * Returns null if the marker is not a cave comment.
 */
function parseMarkerText(afterPrefix: string): { kind: CommentKind; text: string } | null {
	const trimmed = afterPrefix.trim();

	// Check for block-comment close (handles `/* cave! */` style)
	const withoutBlockClose = trimmed.replace(/\s*\*\/\s*$/, "").trim();

	const toCheck = withoutBlockClose;

	if (toCheck.startsWith("cave!")) {
		return { kind: "fire", text: toCheck.slice(5).trim() };
	}
	if (toCheck.startsWith("cave?")) {
		return { kind: "qa", text: toCheck.slice(5).trim() };
	}
	// Must be exactly "cave" or "cave " followed by context text (not cave! or cave?)
	if (toCheck === "cave" || toCheck.startsWith("cave ")) {
		return { kind: "context", text: toCheck.slice(4).trim() };
	}

	return null;
}

/**
 * Parse all cave comments from file content.
 *
 * @param content — full file text
 * @param ext — file extension (without dot), used to determine comment prefixes
 */
export function parseCaveComments(content: string, ext: string): CaveComment[] {
	const prefixes = getPrefixesForExt(ext);
	const lines = content.split("\n");
	const results: CaveComment[] = [];

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
 * Remove a cave comment line from file content by 1-indexed line number.
 * Returns the modified content string.
 */
export function removeLine(content: string, lineNumber: number): string {
	const lines = content.split("\n");
	if (lineNumber < 1 || lineNumber > lines.length) return content;
	lines.splice(lineNumber - 1, 1);
	return lines.join("\n");
}
