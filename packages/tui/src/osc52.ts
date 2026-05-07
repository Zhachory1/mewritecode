/**
 * OSC-52 clipboard write primitive.
 *
 * The terminal-native "set clipboard" sequence: `\e]52;c;<base64>\x07`.
 * Works over SSH because it lives in the byte stream, not in any local
 * clipboard daemon. Limit comes from terminal buffer caps — most modern
 * terminals accept ~75k base64 bytes (a few MB rendered, but base64 is the
 * wire format). We truncate at 74_994 to leave headroom for the framing
 * bytes (`\e]52;c;` + `\x07`).
 */

/** Maximum decoded character count we accept before truncation, conservative. */
export const OSC52_MAX_BYTES = 74_994;

/** Buffers the input and returns the OSC-52 sequence ready to write. */
export function encodeOsc52(
	text: string,
	options: { primary?: boolean } = {},
): {
	sequence: string;
	truncated: boolean;
	bytes: number;
} {
	const target = options.primary ? "p" : "c";
	let truncated = false;
	let payload = text;
	// Conservative byte budget: encode and check length; if over limit, slice
	// the source string and re-encode. We bias toward source-character count
	// because most terminals advertise a base64 limit, not a character limit.
	let encoded = Buffer.from(payload, "utf8").toString("base64");
	if (encoded.length > OSC52_MAX_BYTES) {
		truncated = true;
		// Find a safe character boundary that fits.
		let lo = 0;
		let hi = payload.length;
		while (lo < hi) {
			const mid = Math.floor((lo + hi + 1) / 2);
			const candidate = payload.slice(0, mid);
			const cb = Buffer.from(candidate, "utf8").toString("base64");
			if (cb.length <= OSC52_MAX_BYTES) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		payload = payload.slice(0, lo);
		encoded = Buffer.from(payload, "utf8").toString("base64");
	}
	return {
		sequence: `\x1b]52;${target};${encoded}\x07`,
		truncated,
		bytes: encoded.length,
	};
}

/** Convenience: write the sequence with a caller-provided emit function. */
export function writeOsc52(
	write: (s: string) => void,
	text: string,
	options?: { primary?: boolean },
): {
	truncated: boolean;
	bytes: number;
} {
	const { sequence, truncated, bytes } = encodeOsc52(text, options);
	write(sequence);
	return { truncated, bytes };
}
