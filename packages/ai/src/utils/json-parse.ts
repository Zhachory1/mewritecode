import { parse as partialParse } from "partial-json";

/**
 * Escape raw (unescaped) control characters that appear inside string literals.
 *
 * Models occasionally stream tool-call arguments containing a literal newline,
 * tab, or other control char inside a JSON string (e.g. a multi-line `edit`
 * payload) instead of the escaped `\n` / `\t`. That is invalid JSON, so both
 * `JSON.parse` and `partial-json` reject it — previously the whole tool-call
 * argument object was silently dropped to `{}`, so the tool ran with empty args,
 * failed, and the model regenerated the identical malformed call in a loop.
 *
 * This walks the string tracking string-literal / escape state and replaces any
 * raw control char (code point < 0x20) found *inside* a string with its JSON
 * escape, leaving structural whitespace between tokens untouched.
 */
function escapeControlCharsInStrings(json: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	for (const ch of json) {
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			out += ch;
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			out += ch;
			continue;
		}
		const code = ch.charCodeAt(0);
		if (inString && code < 0x20) {
			switch (ch) {
				case "\n":
					out += "\\n";
					break;
				case "\r":
					out += "\\r";
					break;
				case "\t":
					out += "\\t";
					break;
				case "\b":
					out += "\\b";
					break;
				case "\f":
					out += "\\f";
					break;
				default:
					out += `\\u${code.toString(16).padStart(4, "0")}`;
			}
			continue;
		}
		out += ch;
	}
	return out;
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = any>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	// Try standard parsing first (fastest for complete, valid JSON).
	try {
		return JSON.parse(partialJson) as T;
	} catch {
		// Repair before any lenient parse: the model may have emitted raw control
		// characters inside a string literal (an unescaped newline/tab in a
		// multi-line payload). `partial-json` does NOT throw on these — it silently
		// truncates the object at the bad char (dropping keys), so we must escape
		// them first to recover the real arguments instead of losing them (which
		// loops the model on the same malformed call). Escaping is a no-op for
		// otherwise-valid JSON, so `partialParse(repaired)` still handles genuine
		// mid-stream truncation identically to the raw input.
		const repaired = escapeControlCharsInStrings(partialJson);
		try {
			return JSON.parse(repaired) as T;
		} catch {
			try {
				const result = partialParse(repaired);
				return (result ?? {}) as T;
			} catch {
				return {} as T;
			}
		}
	}
}
