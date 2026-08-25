import { describe, expect, it } from "vitest";
import { parseStreamingJson } from "../src/utils/json-parse.js";

describe("parseStreamingJson", () => {
	it("parses complete JSON", () => {
		expect(parseStreamingJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
	});

	it("returns {} for empty/undefined input", () => {
		expect(parseStreamingJson(undefined)).toEqual({});
		expect(parseStreamingJson("")).toEqual({});
		expect(parseStreamingJson("   ")).toEqual({});
	});

	it("recovers a raw newline inside a string literal", () => {
		// A model emitting a multi-line edit payload with a literal newline
		// instead of the escaped \n. Previously dropped to {}.
		const raw = '{"path":"a.ts","content":"line1\nline2"}';
		expect(parseStreamingJson(raw)).toEqual({ path: "a.ts", content: "line1\nline2" });
	});

	it("recovers raw tab and carriage-return inside strings", () => {
		const raw = '{"text":"a\tb\rc"}';
		expect(parseStreamingJson(raw)).toEqual({ text: "a\tb\rc" });
	});

	it("does not corrupt escaped sequences or quotes in strings", () => {
		const raw = '{"s":"a\\"b\\nc"}';
		expect(parseStreamingJson(raw)).toEqual({ s: 'a"b\nc' });
	});

	it("recovers a raw newline in incomplete (streaming) JSON", () => {
		const raw = '{"path":"a.ts","content":"line1\nline2';
		expect(parseStreamingJson(raw)).toEqual({ path: "a.ts", content: "line1\nline2" });
	});

	it("leaves structural whitespace between tokens intact", () => {
		const raw = '{\n  "a": 1,\n  "b": 2\n}';
		expect(parseStreamingJson(raw)).toEqual({ a: 1, b: 2 });
	});
});
