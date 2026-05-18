/**
 * WS8: `diff` edit format — Aider's SEARCH/REPLACE block format.
 *
 * Wire format (each edit):
 *
 *   path/to/file.ext
 *   <<<<<<< SEARCH
 *   <existing content to find>
 *   =======
 *   <new content to write>
 *   >>>>>>> REPLACE
 *
 * The `diff-fenced` variant wraps the same SEARCH/REPLACE block in a single
 * markdown fence, used by models (Gemini) that prefer fenced output.
 */

import type { EditFormat, FileEdit, ParseEditsResult } from "./types.js";

const SYSTEM_PROMPT_DIFF = `You are emitting file edits in the DIFF format using SEARCH/REPLACE blocks.

For each change, output the file path on its own line, then a block of:

path/to/file.ext
<<<<<<< SEARCH
<exact existing lines to find>
=======
<replacement lines>
>>>>>>> REPLACE

Rules:
- The SEARCH section must match the existing file VERBATIM, including
  whitespace, indentation and surrounding lines required for unique match.
- Use multiple blocks per file when needed.
- For new files, leave SEARCH empty.
- Do not put SEARCH/REPLACE blocks inside markdown fences (use the
  \`diff-fenced\` variant if your model requires fences).`;

const SYSTEM_PROMPT_DIFF_FENCED = `You are emitting file edits in the DIFF-FENCED format.

For each change, output a single fenced block:

\`\`\`
path/to/file.ext
<<<<<<< SEARCH
<exact existing lines>
=======
<replacement lines>
>>>>>>> REPLACE
\`\`\`

Rules: same as DIFF, but the SEARCH/REPLACE block is wrapped in a single
markdown fence (no language tag). One fence per logical edit.`;

const HEAD = "<<<<<<< SEARCH";
const SEP = "=======";
const TAIL = ">>>>>>> REPLACE";

interface RawBlock {
	file: string;
	before: string;
	after: string;
}

/** Split `reply` into SEARCH/REPLACE blocks, ignoring surrounding fences. */
function findBlocks(
	reply: string,
	opts: { fenced: boolean },
): { blocks: RawBlock[]; warnings: string[]; prose: string } {
	const blocks: RawBlock[] = [];
	const warnings: string[] = [];
	const proseChunks: string[] = [];

	// If fenced, strip the outer ``` ... ``` wrappers first by extracting
	// fenced segments and recursing on each.
	const segments: string[] = [];
	if (opts.fenced) {
		const fence = /```[^\n]*\n([\s\S]*?)```/g;
		let cursor = 0;
		for (const m of reply.matchAll(fence)) {
			const idx = m.index ?? 0;
			if (idx > cursor) proseChunks.push(reply.slice(cursor, idx));
			segments.push(m[1]);
			cursor = idx + m[0].length;
		}
		if (cursor < reply.length) proseChunks.push(reply.slice(cursor));
	} else {
		segments.push(reply);
	}

	for (const segment of segments) {
		const lines = segment.split("\n");
		let i = 0;
		let lastFile = "";
		while (i < lines.length) {
			const line = lines[i];
			if (line === HEAD) {
				// Find file: the most recent non-empty preceding line.
				let fileLine = lastFile;
				if (!fileLine) {
					for (let j = i - 1; j >= 0; j--) {
						if (lines[j].trim()) {
							fileLine = lines[j].trim();
							break;
						}
					}
				}
				if (!fileLine) {
					warnings.push("diff: SEARCH block with no preceding filename");
					i++;
					continue;
				}
				// Find separator + tail
				let sep = -1;
				let tail = -1;
				for (let j = i + 1; j < lines.length; j++) {
					if (lines[j] === SEP && sep === -1) sep = j;
					else if (lines[j] === TAIL) {
						tail = j;
						break;
					}
				}
				if (sep === -1 || tail === -1) {
					warnings.push(`diff: malformed block at line ${i} for ${fileLine}`);
					i++;
					continue;
				}
				const before = lines.slice(i + 1, sep).join("\n");
				const after = lines.slice(sep + 1, tail).join("\n");
				blocks.push({ file: fileLine, before, after });
				lastFile = fileLine;
				i = tail + 1;
			} else {
				if (!opts.fenced && line.trim()) {
					// Best-effort prose collection between blocks for non-fenced.
					proseChunks.push(`${line}\n`);
				}
				i++;
			}
		}
	}

	return { blocks, warnings, prose: proseChunks.join("").trim() };
}

function parseDiffImpl(reply: string, opts: { fenced: boolean }): ParseEditsResult {
	const { blocks, warnings, prose } = findBlocks(reply, opts);
	const edits: FileEdit[] = blocks.map((b) => ({
		file: b.file,
		mode: "patch",
		before: b.before,
		after: b.after,
	}));
	return { edits, warnings, prose };
}

export function parseDiff(reply: string): ParseEditsResult {
	return parseDiffImpl(reply, { fenced: false });
}

export function parseDiffFenced(reply: string): ParseEditsResult {
	return parseDiffImpl(reply, { fenced: true });
}

export const diffFormat: EditFormat = {
	name: "diff",
	systemPromptFragment: SYSTEM_PROMPT_DIFF,
	parse: parseDiff,
};

export const diffFencedFormat: EditFormat = {
	name: "diff-fenced",
	systemPromptFragment: SYSTEM_PROMPT_DIFF_FENCED,
	parse: parseDiffFenced,
};
