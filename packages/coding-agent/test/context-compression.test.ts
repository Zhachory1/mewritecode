import { fauxAssistantMessage } from "@zhachory1/mewrite-ai";
import { describe, expect, it } from "vitest";
import { type ContextCompressor, compressContextPack } from "../src/core/context-compression.js";
import { type ContextBundle, type ContextPack, formatContextPackEvidence } from "../src/core/context-engine.js";
import { createHarness } from "./suite/harness.js";

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
	return {
		id: "bundle-1",
		source: "test",
		entityType: "doc",
		title: "Test bundle",
		content: "This is a long test context bundle that can be safely shortened.",
		score: 0.9,
		provenance: { path: "docs/test.md", startLine: 1, endLine: 3, memoryId: "mem-1" },
		retrievalHandle: { type: "gbrain", id: "default::docs/test#1" },
		freshness: { indexedAt: "2026-07-01", stale: false },
		...overrides,
	};
}

function pack(bundles: ContextBundle[]): ContextPack {
	return { bundles, sources: { test: { ok: true } } };
}

function compressor(
	output: (input: { id: string; content: string }) => { id: string; content: string },
): ContextCompressor {
	return {
		name: "fake",
		compress: async (input) => output(input),
	};
}

describe("Context compression M4a", () => {
	it("keeps missing compression metadata exact-preserve", async () => {
		let calls = 0;
		const result = await compressContextPack(
			pack([bundle()]),
			{
				name: "fake",
				compress: async (input) => {
					calls++;
					return { id: input.id, content: "short" };
				},
			},
			{ enabled: true },
		);

		expect(calls).toBe(0);
		expect(result.pack.bundles[0].content).toContain("long test context");
		expect(result.stats.skippedExact).toBe(1);
	});

	it("routes high-noise bundles to lossy-ok compression", async () => {
		const result = await compressContextPack(
			pack([
				bundle({
					id: "ci",
					entityType: "ci-log",
					title: "CI log",
					content: "line\n".repeat(200),
					provenance: { path: "build.log" },
				}),
				bundle({
					id: "tool-json",
					entityType: "tool-json",
					title: "Tool JSON",
					content: JSON.stringify({
						rows: Array.from({ length: 40 }, (_, index) => ({ index, value: `value-${index}` })),
					}),
					provenance: { toolCallId: "tool-1" },
				}),
			]),
			compressor((input) => ({ id: input.id, content: `short ${input.id}` })),
			{ enabled: true },
		);

		expect(result.pack.bundles.map((b) => b.content)).toEqual(["short ci", "short tool-json"]);
		expect(result.pack.bundles.map((b) => b.compression?.reason)).toEqual([
			"context-compression-router",
			"context-compression-router",
		]);
		expect(result.stats.attempted).toBe(2);
		expect(result.stats.compressed).toBe(2);
	});

	it("keeps exact-detail bundles exact unless explicitly marked", async () => {
		const result = await compressContextPack(
			pack([
				bundle({ entityType: "code-chunk", content: "const exact = true;", provenance: { path: "src/exact.ts" } }),
				bundle({ entityType: "diff", content: "@@ -1 +1", provenance: { path: "change.diff" } }),
				bundle({
					entityType: "tool-json",
					content: '{"scripts":{"test":"vitest"}}',
					provenance: { path: "package.json" },
				}),
				bundle({ entityType: "memory", content: "remember exact fact", provenance: { memoryId: "mem-1" } }),
				bundle({ entityType: "citation", content: "citation text", provenance: { url: "https://example.test" } }),
			]),
			compressor((input) => ({ id: input.id, content: "short" })),
			{ enabled: true },
		);

		expect(result.stats.attempted).toBe(0);
		expect(result.stats.skippedExact).toBe(5);
		expect(result.pack.bundles.map((b) => b.content)).toEqual([
			"const exact = true;",
			"@@ -1 +1",
			'{"scripts":{"test":"vitest"}}',
			"remember exact fact",
			"citation text",
		]);
	});

	it("honors explicit exact-preserve over router allowlists", async () => {
		const result = await compressContextPack(
			pack([
				bundle({
					entityType: "ci-log",
					content: "line\n".repeat(200),
					compression: { mode: "exact-preserve", reason: "debug exact frames" },
					provenance: { path: "ci.log" },
				}),
			]),
			compressor((input) => ({ id: input.id, content: "short" })),
			{ enabled: true },
		);

		expect(result.stats.attempted).toBe(0);
		expect(result.stats.skippedExact).toBe(1);
		expect(result.pack.bundles[0].content).toContain("line");
	});

	it("compresses explicit lossy-ok bundles and preserves metadata", async () => {
		const original = bundle({ compression: { mode: "lossy-ok", reason: "fixture" } });
		const result = await compressContextPack(
			pack([original]),
			compressor((input) => ({ id: input.id, content: "short" })),
			{
				enabled: true,
			},
		);
		const compressed = result.pack.bundles[0];

		expect(compressed.content).toBe("short");
		expect(compressed.provenance).toEqual(original.provenance);
		expect(compressed.retrievalHandle).toEqual(original.retrievalHandle);
		expect(compressed.freshness).toEqual(original.freshness);
		expect(compressed.compression?.result).toMatchObject({ compressed: true, lossy: true, provider: "fake" });
		expect(result.stats.attempted).toBe(1);
		expect(result.stats.compressed).toBe(1);
	});

	it("falls back on id mismatch", async () => {
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "lossy-ok" } })]),
			compressor(() => ({ id: "other", content: "short" })),
			{ enabled: true },
		);

		expect(result.pack.bundles[0].content).toContain("long test context");
		expect(result.stats.failed).toBe(1);
		expect(result.stats.fallbackReason).toBe("id-mismatch");
	});

	it("falls back on empty output", async () => {
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "lossy-ok" } })]),
			compressor((input) => ({ id: input.id, content: "   " })),
			{ enabled: true },
		);

		expect(result.pack.bundles[0].content).toContain("long test context");
		expect(result.stats.fallbackReason).toBe("empty-output");
	});

	it("falls back when output is not smaller", async () => {
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "lossy-ok" } })]),
			compressor((input) => ({ id: input.id, content: `${input.content} plus more` })),
			{ enabled: true },
		);

		expect(result.pack.bundles[0].content).toContain("long test context");
		expect(result.stats.fallbackReason).toBe("not-smaller");
	});

	it("falls back on compressor throw", async () => {
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "lossy-ok" } })]),
			{
				name: "fake",
				compress: async () => {
					throw new Error("boom");
				},
			},
			{ enabled: true },
		);

		expect(result.pack.bundles[0].content).toContain("long test context");
		expect(result.stats.fallbackReason).toBe("compressor-error");
	});

	it("marks compressed/lossy evidence when rendered", async () => {
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "lossy-ok" } })]),
			compressor((input) => ({ id: input.id, content: "short" })),
			{ enabled: true },
		);
		const formatted = formatContextPackEvidence(result.pack);
		const text = JSON.stringify(
			formatted.message && "content" in formatted.message ? formatted.message.content : undefined,
		);

		expect(text).toContain('compressed=\\"true\\"');
		expect(text).toContain('lossy=\\"true\\"');
		expect(text).toContain('compressionProvider=\\"fake\\"');
		expect(text).toContain('memoryId=\\"mem-1\\"');
	});

	it("integrates with AgentSession model input and status", async () => {
		let payloadText = "";
		const harness = await createHarness({
			settings: { contextEngine: { enabled: true, provider: "fake", compression: { enabled: true } } },
			contextEngine: {
				name: "fake",
				health: async () => ({ enabled: true, provider: "fake", ok: true }),
				retrieve: async () =>
					pack([
						bundle({
							id: "ci-log",
							entityType: "ci-log",
							title: "CI log",
							content: "long test context\n".repeat(100),
							provenance: { path: "ci.log" },
						}),
						bundle({
							id: "code",
							entityType: "code-chunk",
							title: "Source code",
							content: "export const codeMustStayExact = true;",
							provenance: { path: "src/exact.ts" },
						}),
					]),
			},
			contextCompressor: compressor((input) => ({ id: input.id, content: "short" })),
		});
		try {
			harness.setResponses([
				(context) => {
					payloadText = JSON.stringify(context.messages);
					return fauxAssistantMessage("ok");
				},
			]);
			await harness.session.prompt("hello");

			expect(payloadText).toContain("short");
			expect(payloadText).not.toContain("long test context");
			expect(payloadText).toContain("codeMustStayExact");
			const status = harness.session.getContextEngineStatusLines().join("\n");
			expect(status).toContain("Compression: enabled");
			expect(status).toContain("attempted=1 compressed=1 skippedExact=1 failed=0");
		} finally {
			harness.cleanup();
		}
	});
});
