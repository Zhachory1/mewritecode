/**
 * Sequential command orchestration (issue #5).
 *
 * Splits a single submitted message on top-level `/then` separators so a user
 * can chain commands across turns:
 *
 *   /writing-plans /then /goal implement until tests are green
 *
 * The head runs in the current turn; each tail entry is enqueued and dispatched
 * after the previous turn settles (agent_end), mirroring the user typing it.
 *
 * Boundary rules — `/then` is only treated as a separator when:
 *   - It appears at a word boundary (start-of-string or whitespace) and is
 *     followed by whitespace + another `/` token (the next command).
 *   - It is NOT inside a fenced code block (``` … ```) or an inline backtick run.
 *
 * These rules keep prose like "first do X then do Y" and code that happens to
 * contain `/then` untouched. The `/then` token itself never expands to anything
 * — it is purely a separator and is consumed by the split.
 */

/** Inline backtick segments and fenced code blocks are preserved verbatim. */
function maskCodeRegions(text: string): { masked: string; segments: string[] } {
	const segments: string[] = [];
	let masked = "";
	let i = 0;
	while (i < text.length) {
		// Fenced block: ```…```
		if (text.startsWith("```", i)) {
			const end = text.indexOf("```", i + 3);
			if (end === -1) {
				segments.push(text.slice(i));
				masked += `\u0000${segments.length - 1}\u0000`;
				return { masked, segments };
			}
			segments.push(text.slice(i, end + 3));
			masked += `\u0000${segments.length - 1}\u0000`;
			i = end + 3;
			continue;
		}
		// Inline backtick run
		if (text[i] === "`") {
			const end = text.indexOf("`", i + 1);
			if (end === -1) {
				// Unterminated — treat the rest as prose so we don't lose user text.
				masked += text.slice(i);
				return { masked, segments };
			}
			segments.push(text.slice(i, end + 1));
			masked += `\u0000${segments.length - 1}\u0000`;
			i = end + 1;
			continue;
		}
		masked += text[i];
		i++;
	}
	return { masked, segments };
}

function unmask(text: string, segments: string[]): string {
	return text.replace(/\u0000(\d+)\u0000/g, (_, idx) => segments[Number(idx)] ?? "");
}

/**
 * Split `text` on top-level `/then` separators. Returns the original (trimmed)
 * text as a single-element array when no separator is present, so callers can
 * always pop the head.
 */
export function splitOnThen(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const { masked, segments } = maskCodeRegions(trimmed);

	// `/then` is a separator iff it's at a word boundary AND followed by
	// whitespace + a `/`-led token. The trailing `/` requirement is what
	// prevents "do X /then write the docs" from splitting on a `/then` that
	// has no following command.
	const SEP = /(^|\s)\/then(?=\s+\/[A-Za-z0-9_:-])/g;

	const parts: string[] = [];
	let cursor = 0;
	SEP.lastIndex = 0;
	let m = SEP.exec(masked);
	while (m !== null) {
		// `m.index` is at the boundary char; `slashIndex` is where the `/then` starts.
		const slashIndex = m.index + m[1].length;
		parts.push(unmask(masked.slice(cursor, slashIndex), segments).trim());
		cursor = slashIndex + "/then".length;
		m = SEP.exec(masked);
	}
	parts.push(unmask(masked.slice(cursor), segments).trim());

	// Drop any empty fragments (shouldn't happen given the regex requires a
	// trailing `/` token, but be defensive in case of edge whitespace).
	return parts.filter((p) => p.length > 0);
}
