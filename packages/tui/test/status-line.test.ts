/**
 * Tests for status line schema parsing + default/detailed renderers.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
	parseStatusLineSettings,
	renderStatusLineDefault,
	renderStatusLineDetailed,
	renderStatusLineSync,
	type StatusLineContext,
	sanitizeOneLine,
	tailPath,
} from "../src/index.js";

function ctx(overrides: Partial<StatusLineContext> = {}): StatusLineContext {
	return {
		hook_event_name: "Status",
		session_id: "s1",
		cwd: "/home/u/proj/sub",
		model: { id: "claude-opus-4-7", display_name: "Opus 4.7" },
		workspace: { current_dir: "/home/u/proj/sub", project_dir: "/home/u/proj" },
		...overrides,
	};
}

describe("parseStatusLineSettings", () => {
	it("returns undefined for null/undefined/non-objects", () => {
		assert.strictEqual(parseStatusLineSettings(undefined), undefined);
		assert.strictEqual(parseStatusLineSettings(null), undefined);
		assert.strictEqual(parseStatusLineSettings([]), undefined);
		assert.strictEqual(parseStatusLineSettings("nope"), undefined);
	});

	it("accepts the canonical Claude Code shape", () => {
		const parsed = parseStatusLineSettings({ type: "command", command: "/bin/echo hi", padding: 2 });
		assert.deepStrictEqual(parsed, { type: "command", command: "/bin/echo hi", padding: 2 });
	});

	it("downgrades type='command' with no command field to 'default'", () => {
		const parsed = parseStatusLineSettings({ type: "command" });
		assert.strictEqual(parsed?.type, "default");
		assert.strictEqual(parsed?.command, undefined);
	});

	it("coerces unknown type values to 'default'", () => {
		const parsed = parseStatusLineSettings({ type: "weird" });
		assert.strictEqual(parsed?.type, "default");
	});

	it("ignores non-finite/negative padding", () => {
		assert.strictEqual(parseStatusLineSettings({ padding: -1 })?.padding, undefined);
		assert.strictEqual(parseStatusLineSettings({ padding: Number.NaN })?.padding, undefined);
		assert.strictEqual(parseStatusLineSettings({ padding: 3 })?.padding, 3);
	});

	it("supports type='detailed'", () => {
		const parsed = parseStatusLineSettings({ type: "detailed" });
		assert.strictEqual(parsed?.type, "detailed");
	});
});

describe("tailPath", () => {
	it("returns the path unchanged when shorter than N components", () => {
		assert.strictEqual(tailPath("/usr", 2), "/usr");
	});

	it("returns the trailing N components", () => {
		assert.strictEqual(tailPath("/a/b/c/d", 2), "c/d");
	});

	it("handles windows-style paths", () => {
		assert.strictEqual(tailPath("C:\\Users\\j\\proj\\src", 2), "proj/src");
	});
});

describe("renderDefault / renderDetailed", () => {
	it("default = model · cwd-tail", () => {
		const text = renderStatusLineDefault(ctx());
		assert.strictEqual(text, "Opus 4.7 · proj/sub");
	});

	it("detailed adds branch, dirty, queued, cost", () => {
		const text = renderStatusLineDetailed(
			ctx({
				cost: { total_cost_usd: 0.0042, total_duration_ms: 1234 },
				cave: { branch: "feat/x", gitDirty: true, queuedMessages: 2 },
			}),
		);
		assert.ok(text.includes("Opus 4.7"));
		assert.ok(text.includes("feat/x*"));
		assert.ok(text.includes("q:2"));
		assert.ok(text.includes("$0.0042"));
	});

	it("detailed omits branch and queue when absent", () => {
		const text = renderStatusLineDetailed(ctx());
		assert.ok(!text.includes("·  ·"));
		assert.ok(!text.includes("q:"));
	});

	it("detailed surfaces 200k overflow indicator", () => {
		const text = renderStatusLineDetailed(ctx({ exceeds_200k_tokens: true }));
		assert.ok(text.includes("200k"));
	});

	it("detailed shows saved bytes when > 0", () => {
		const text = renderStatusLineDetailed(ctx({ cave: { savedBytes: 12_288 } }));
		assert.ok(text.includes("saved 12kB"), text);
	});

	it("detailed omits saved segment when 0/absent", () => {
		assert.ok(!renderStatusLineDetailed(ctx({ cave: { savedBytes: 0 } })).includes("saved"));
		assert.ok(!renderStatusLineDetailed(ctx()).includes("saved"));
	});
});

describe("renderStatusLineSync", () => {
	it("falls back to default for type='command' (sync caller cannot run it)", () => {
		const result = renderStatusLineSync({ type: "command", command: "/bin/echo" }, ctx());
		assert.strictEqual(result.source, "default");
	});

	it("returns 'detailed' source for the detailed renderer", () => {
		const result = renderStatusLineSync({ type: "detailed" }, ctx());
		assert.strictEqual(result.source, "detailed");
	});
});

describe("sanitizeOneLine", () => {
	it("collapses newlines to spaces and trims", () => {
		assert.strictEqual(sanitizeOneLine("  hello\nworld\r\n"), "hello world");
	});
});
