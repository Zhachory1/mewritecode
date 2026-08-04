/**
 * Regression: TUI freeze during model streaming.
 *
 * While a code fence is still streaming in, its language must be stripped so
 * the markdown renderer skips syntax highlighting for the in-flight block.
 * Highlighting a still-growing block re-runs a CPU-bound pass over an
 * ever-larger buffer on every frame (O(N^2) over a long response), which
 * stalls the single-threaded TUI loop and looks like a freeze. Once the
 * closing fence arrives the language is preserved so the finished block
 * highlights normally.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { balancePartial } from "../src/index.js";

describe("balancePartial code-fence handling", () => {
	it("strips the language of an open (still-streaming) fence", () => {
		const partial = "Here is code:\n```typescript\nconst x = 1;";
		const out = balancePartial(partial);
		// Opener language removed so the renderer won't highlight the in-flight block.
		assert.match(out, /^```\n/m);
		assert.doesNotMatch(out, /```typescript/);
		// A closing fence is appended so the render terminates cleanly.
		assert.ok(out.trimEnd().endsWith("```"));
		// Code content is preserved.
		assert.ok(out.includes("const x = 1;"));
	});

	it("preserves the language once the fence is closed", () => {
		const complete = "Here is code:\n```typescript\nconst x = 1;\n```";
		const out = balancePartial(complete);
		// Even fence count → nothing stripped, language kept for full highlight.
		assert.match(out, /```typescript/);
	});

	it("leaves prose without fences untouched", () => {
		const prose = "Just a sentence with no code.";
		assert.strictEqual(balancePartial(prose), prose);
	});

	it("only strips the last (open) fence when an earlier block is closed", () => {
		const text = ["```js", "closed();", "```", "prose", "```python", "open_block("].join("\n");
		const out = balancePartial(text);
		// First, closed block keeps its language.
		assert.match(out, /```js/);
		// The trailing open block loses its language.
		assert.doesNotMatch(out, /```python/);
		assert.ok(out.includes("open_block("));
	});
});
