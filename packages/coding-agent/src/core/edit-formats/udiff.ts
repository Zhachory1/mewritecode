/**
 * WS8: `udiff` edit format — unified-diff hunks.
 *
 * Wire format:
 *
 *   --- a/path/to/file.ext
 *   +++ b/path/to/file.ext
 *   @@ -<startA>,<countA> +<startB>,<countB> @@
 *   <context line>
 *   -<removed line>
 *   +<added line>
 *   <context line>
 *
 * Strong choice for high-capability models that emit clean unified diffs
 * (GPT-4o, Claude 3.5+). Aider showed gpt-4-turbo udiff was ~3× more reliable
 * than diff format on its benchmark suite.
 */

import type { EditFormat, FileEdit, ParseEditsResult } from "./types.js";

const SYSTEM_PROMPT = `You are emitting file edits as UNIFIED DIFFS.

Output every change as a unified-diff hunk. Use \`---\`/\`+++\` headers and
\`@@\` hunk markers. Use \`a/\` and \`b/\` path prefixes (standard \`diff -u\`
output). Multiple files: emit multiple \`---\`/\`+++\` blocks.

Example:

\`\`\`diff
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,3 +10,3 @@
 export function foo() {
-  return 1;
+  return 2;
 }
\`\`\`

Rules:
- Include enough context lines (3 by default) for unambiguous application.
- Do not abbreviate hunks with ellipses or \`...\`.
- New files: use \`/dev/null\` as the \`---\` source.`;

const HEADER_RE = /^(?:---|\+\+\+) (?:a\/|b\/)?([^\n\t]+)/;

export function parseUdiff(reply: string): ParseEditsResult {
	const edits: FileEdit[] = [];
	const warnings: string[] = [];
	const lines = reply.split("\n");

	// Strip optional ```diff fences
	const stripped: string[] = [];
	let inFence = false;
	for (const line of lines) {
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		stripped.push(line);
	}

	let i = 0;
	const proseLines: string[] = [];
	while (i < stripped.length) {
		const line = stripped[i];
		if (line.startsWith("--- ") && i + 1 < stripped.length && stripped[i + 1].startsWith("+++ ")) {
			const minusMatch = HEADER_RE.exec(line);
			const plusMatch = HEADER_RE.exec(stripped[i + 1]);
			if (!minusMatch || !plusMatch) {
				warnings.push(`udiff: malformed header at line ${i}`);
				i++;
				continue;
			}
			// Use the +++ side as the file (covers /dev/null source for new files).
			const file = plusMatch[1] === "/dev/null" ? minusMatch[1] : plusMatch[1];
			// Collect hunk lines until next file header or EOF.
			let j = i + 2;
			const hunkLines: string[] = [stripped[i], stripped[i + 1]];
			while (j < stripped.length) {
				if (stripped[j].startsWith("--- ") && j + 1 < stripped.length && stripped[j + 1].startsWith("+++ ")) {
					break;
				}
				hunkLines.push(stripped[j]);
				j++;
			}
			edits.push({ file, mode: "udiff", udiff: hunkLines.join("\n") });
			i = j;
		} else {
			if (line.trim()) proseLines.push(line);
			i++;
		}
	}

	return { edits, prose: proseLines.join("\n").trim(), warnings };
}

export const udiffFormat: EditFormat = {
	name: "udiff",
	systemPromptFragment: SYSTEM_PROMPT,
	parse: parseUdiff,
};
