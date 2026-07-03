import { describe, expect, it } from "vitest";
import type { ContextBundle, ContextEngine, ContextPack } from "../src/core/context-engine.js";
import { ContextStackEngine, mergeAndBudgetBundles } from "../src/core/context-providers/stack.js";

function bundle(id: string, source: string, score: number | undefined, content = "content"): ContextBundle {
	return {
		id,
		source,
		entityType: source === "codescry" ? "code-chunk" : "memory",
		title: id,
		content,
		score,
		provenance: { path: `${source}/${id}` },
	};
}

function pack(bundles: ContextBundle[]): ContextPack {
	return { bundles, sources: {} };
}

function engine(bundles: ContextBundle[], delayMs = 0): ContextEngine {
	return {
		name: "fake",
		health: async () => ({ enabled: true, provider: "fake", ok: true }),
		retrieve: async ({ signal }) => {
			if (delayMs > 0) {
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, delayMs);
					signal?.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
			}
			return pack(bundles);
		},
	};
}

describe("ContextStackEngine", () => {
	it("preserves top one per source before filling by score", () => {
		const result = mergeAndBudgetBundles(
			[
				bundle("code-low", "codescry", 0.1, "x".repeat(100)),
				bundle("qmd-high", "qmd", 0.9, "x".repeat(100)),
				bundle("qmd-mid", "qmd", 0.8, "x".repeat(100)),
			],
			1000,
		);

		expect(result.bundles.map((b) => b.id)).toEqual(["code-low", "qmd-high", "qmd-mid"]);
		expect(result.includedBySource).toEqual({ codescry: 1, qmd: 2 });
	});

	it("drops deterministic lower priority bundles under budget", () => {
		const result = mergeAndBudgetBundles(
			[
				bundle("code", "codescry", 0.1, "x".repeat(100)),
				bundle("qmd-high", "qmd", 0.9, "x".repeat(100)),
				bundle("qmd-low", "qmd", 0.2, "x".repeat(2000)),
			],
			300,
		);

		expect(result.bundles.map((b) => b.id)).toEqual(["code", "qmd-high"]);
		expect(result.droppedBySource).toEqual({ qmd: 1 });
	});

	it("sorts missing scores last after source minimums", () => {
		const result = mergeAndBudgetBundles(
			[
				bundle("code", "codescry", undefined, "x".repeat(100)),
				bundle("qmd-scored", "qmd", 0.5, "x".repeat(100)),
				bundle("qmd-missing", "qmd", undefined, "x".repeat(100)),
			],
			1000,
		);

		expect(result.bundles.map((b) => b.id)).toEqual(["code", "qmd-scored", "qmd-missing"]);
	});

	it("returns both provider bundles when both succeed", async () => {
		const stack = new ContextStackEngine({
			childTimeoutMs: 100,
			children: [
				{
					name: "codescry",
					engine: engine([bundle("code", "codescry", 0.8)]),
					includeCode: true,
					includeMemory: false,
				},
				{ name: "qmd", engine: engine([bundle("memory", "qmd", 0.7)]), includeCode: false, includeMemory: true },
			],
		});
		const result = await stack.retrieve({
			rawUserPrompt: "hello",
			cwd: process.cwd(),
			budgetTokens: 1000,
			includeCode: true,
			includeMemory: true,
		});

		expect(result.bundles.map((b) => b.id)).toEqual(["code", "memory"]);
		expect(result.sources.codescry.ok).toBe(true);
		expect(result.sources.qmd.ok).toBe(true);
	});

	it("slow qmd does not suppress fast codescry", async () => {
		const stack = new ContextStackEngine({
			childTimeoutMs: 10,
			children: [
				{
					name: "codescry",
					engine: engine([bundle("code", "codescry", 0.8)]),
					includeCode: true,
					includeMemory: false,
				},
				{
					name: "qmd",
					engine: engine([bundle("memory", "qmd", 0.7)], 1000),
					includeCode: false,
					includeMemory: true,
				},
			],
		});
		const result = await stack.retrieve({
			rawUserPrompt: "hello",
			cwd: process.cwd(),
			budgetTokens: 1000,
			includeCode: true,
			includeMemory: true,
		});

		expect(result.bundles.map((b) => b.id)).toEqual(["code"]);
		expect(result.sources.codescry.ok).toBe(true);
		expect(result.sources.qmd.ok).toBe(false);
		expect(result.sources.qmd.detail).toContain("state=timeout");
	});

	it("slow codescry does not suppress fast qmd", async () => {
		const stack = new ContextStackEngine({
			childTimeoutMs: 10,
			children: [
				{
					name: "codescry",
					engine: engine([bundle("code", "codescry", 0.8)], 1000),
					includeCode: true,
					includeMemory: false,
				},
				{ name: "qmd", engine: engine([bundle("memory", "qmd", 0.7)]), includeCode: false, includeMemory: true },
			],
		});
		const result = await stack.retrieve({
			rawUserPrompt: "hello",
			cwd: process.cwd(),
			budgetTokens: 1000,
			includeCode: true,
			includeMemory: true,
		});

		expect(result.bundles.map((b) => b.id)).toEqual(["memory"]);
		expect(result.sources.codescry.ok).toBe(false);
		expect(result.sources.qmd.ok).toBe(true);
	});

	it("parent abort propagates", async () => {
		const stack = new ContextStackEngine({
			childTimeoutMs: 1000,
			children: [
				{
					name: "qmd",
					engine: engine([bundle("memory", "qmd", 0.7)], 1000),
					includeCode: false,
					includeMemory: true,
				},
			],
		});
		const controller = new AbortController();
		const promise = stack.retrieve({
			rawUserPrompt: "hello",
			cwd: process.cwd(),
			budgetTokens: 1000,
			includeCode: true,
			includeMemory: true,
			signal: controller.signal,
		});
		controller.abort();

		await expect(promise).rejects.toThrow();
	});
});
