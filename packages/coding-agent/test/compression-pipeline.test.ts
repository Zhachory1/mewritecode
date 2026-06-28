/**
 * Unit coverage for the CompressionPipeline extracted from agent-session.ts
 * (#16 stage 4). We test the branches that do NOT invoke LLMLingua-2 so the
 * suite stays fast and dep-free; ML behavior is exercised via the existing
 * end-to-end suite.
 */

import type { AgentMessage } from "@zhachory1/mewrite-agent";
import { describe, expect, it } from "vitest";
import { CompressionPipeline, sumTextLen } from "../src/core/compression-pipeline.js";
import { SavingsTracker } from "../src/core/savings-tracker.js";

const noMLSettings = {
	getCaveModeMLCompression: () => false,
	getCaveModeEnabled: () => true,
};

const offSettings = {
	getCaveModeMLCompression: () => false,
	getCaveModeEnabled: () => false,
};

describe("sumTextLen", () => {
	it("sums utf-8 bytes across text blocks, ignoring non-text", () => {
		expect(
			sumTextLen([
				{ type: "text", text: "abc" },
				{ type: "image", data: "..." },
				{ type: "text", text: "déf" }, // é is 2 utf-8 bytes
			]),
		).toBe(3 + 4);
	});

	it("returns 0 for non-array input", () => {
		expect(sumTextLen(null)).toBe(0);
		expect(sumTextLen(undefined)).toBe(0);
		expect(sumTextLen("not an array")).toBe(0);
	});

	it("returns 0 for arrays without text blocks", () => {
		expect(sumTextLen([{ type: "image" }, { type: "tool_use" }])).toBe(0);
	});
});

describe("CompressionPipeline.tryReadDedup", () => {
	it("first read is NOT a dedup hit; books nothing into savings", () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		const out = pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: "hello" }]);
		expect(out.stubContent).toBeUndefined();
		expect(out.fullBytes).toBe(5);
		expect(savings.totals(0).bytesSaved).toBe(0);
		expect(savings.totals(0).totalToolOutputBytes).toBe(0);
	});

	it("identical second read short-circuits with a stub and books dedup savings", () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		// File contents must be larger than the dedup stub text for the saving
		// delta to be positive (the tracker clamps negative deltas to 0).
		const big = "line\n".repeat(500); // ~2.5 KB
		pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: big }]);
		const out = pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: big }]);
		expect(out.stubContent).toBeDefined();
		expect(out.stubContent![0].type).toBe("text");
		expect(out.stubContent![0].text).toContain("unchanged");
		const totals = savings.totals(0);
		expect(totals.totalToolOutputBytes).toBe(Buffer.byteLength(big, "utf8"));
		expect(totals.bySource.dedup.bytes).toBeGreaterThan(0);
		expect(totals.bySource.compression.bytes).toBe(0);
	});

	it("changed content does NOT short-circuit on the second read", () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: "v1" }]);
		const out = pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: "v2" }]);
		expect(out.stubContent).toBeUndefined();
		expect(savings.totals(0).bySource.dedup.bytes).toBe(0);
	});

	it("invalidateDedup forces the next read to re-fingerprint", () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: "same" }]);
		pipe.invalidateDedup("/a/b.txt");
		const out = pipe.tryReadDedup("/a/b.txt", [{ type: "text", text: "same" }]);
		expect(out.stubContent).toBeUndefined();
	});
});

describe("CompressionPipeline.compressToolResult (rule-based path)", () => {
	it("runs rule-based stages when ML compression is disabled (smoke)", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		// A trivially small input — the rule-based stages may not compress further,
		// but they must return without throwing and yield a content array.
		const out = await pipe.compressToolResult("bash", { command: "ls" }, [{ type: "text", text: "file1\nfile2\n" }]);
		expect(Array.isArray(out)).toBe(true);
		expect(out[0].type).toBe("text");
	});

	it("keeps task output beyond generic cave truncation", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		const longTaskOutput = Array.from({ length: 700 }, (_, i) => `line ${i}`).join("\n");

		const out = await pipe.compressToolResult("task", {}, [{ type: "text", text: longTaskOutput }]);
		const text = out[0].type === "text" ? out[0].text : "";

		expect(text).toContain("line 0");
		expect(text).toContain("line 350");
		expect(text).toContain("line 699");
		expect(text).not.toContain("cave mode truncation");
	});

	it("keeps middle task sections that generic line budgets would drop", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		const taskOutput = [
			Array.from({ length: 850 }, (_, i) => `alpha ${i}`).join("\n"),
			"MIDDLE_AGENT_ACTIONABLE_FINDING",
			Array.from({ length: 450 }, (_, i) => `omega ${i}`).join("\n"),
		].join("\n");

		const out = await pipe.compressToolResult("task", {}, [{ type: "text", text: taskOutput }]);
		const text = out[0].type === "text" ? out[0].text : "";

		expect(text).toContain("alpha 0");
		expect(text).toContain("MIDDLE_AGENT_ACTIONABLE_FINDING");
		expect(text).toContain("omega 449");
		expect(text).not.toContain("task budget");
	});

	it("does not run ML compression for task outputs", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(
			{ getCaveModeMLCompression: () => true, getCaveModeEnabled: () => true },
			savings,
		);
		const taskOutput = "ACTIONABLE_TASK_OUTPUT".repeat(500);

		const out = await pipe.compressToolResult("task", {}, [{ type: "text", text: taskOutput }]);
		const text = out[0].type === "text" ? out[0].text : "";

		expect(text).toBe(taskOutput);
	});

	it("preserves non-text blocks verbatim", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		const out = await pipe.compressToolResult("read", { path: "/x" }, [
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
		]);
		expect(out[0].type).toBe("image");
	});
});

describe("CompressionPipeline.softCompactTransform (no-op gates)", () => {
	function makeMessages(): AgentMessage[] {
		// 3 round-trips; pure text payloads. Cast through unknown — tests only
		// exercise the gate branches that early-return BEFORE LLMLingua runs.
		return [
			{ role: "user", content: [{ type: "text", text: "u1" }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "a1" }], timestamp: 2 },
			{ role: "toolResult", content: [{ type: "text", text: "r1".repeat(500) }], timestamp: 3 },
			{ role: "assistant", content: [{ type: "text", text: "a2" }], timestamp: 4 },
		] as unknown as AgentMessage[];
	}

	it("returns messages unchanged when cave mode is OFF", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(offSettings, savings);
		const msgs = makeMessages();
		const out = await pipe.softCompactTransform(msgs, 1_000);
		expect(out).toBe(msgs);
	});

	it("returns messages unchanged when ML compression is OFF (even with cave mode ON)", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(noMLSettings, savings);
		const msgs = makeMessages();
		const out = await pipe.softCompactTransform(msgs, 1_000);
		expect(out).toBe(msgs);
	});

	it("does not soft-compact task tool results", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(
			{ getCaveModeMLCompression: () => true, getCaveModeEnabled: () => true },
			savings,
			{ softThreshold: 0.01, softRecencyWindow: 0 },
		);
		const taskResult = {
			role: "toolResult",
			toolName: "task",
			content: [{ type: "text", text: "ACTIONABLE_TASK_RESULT".repeat(500) }],
			timestamp: 3,
		};
		const msgs = [
			{ role: "user", content: [{ type: "text", text: "u1" }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "a1" }], timestamp: 2 },
			taskResult,
			{ role: "assistant", content: [{ type: "text", text: "a2" }], timestamp: 4 },
			{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "r2" }], timestamp: 5 },
		] as unknown as AgentMessage[];

		const out = await pipe.softCompactTransform(msgs, 1_000);
		expect(out[2]).toBe(taskResult);
	});

	it("returns messages unchanged when contextWindow is 0 (no model selected)", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(
			{ getCaveModeMLCompression: () => true, getCaveModeEnabled: () => true },
			savings,
		);
		const msgs = makeMessages();
		const out = await pipe.softCompactTransform(msgs, 0);
		expect(out).toBe(msgs);
	});

	it("returns messages unchanged when usage is BELOW the soft threshold", async () => {
		const savings = new SavingsTracker();
		const pipe = new CompressionPipeline(
			{ getCaveModeMLCompression: () => true, getCaveModeEnabled: () => true },
			savings,
			{ softThreshold: 0.99 }, // very high; the small fixture will stay below
		);
		const msgs = makeMessages();
		const out = await pipe.softCompactTransform(msgs, 1_000_000);
		expect(out).toBe(msgs);
	});
});

describe("CompressionPipeline construction", () => {
	it("exposes configurable soft thresholds with sensible defaults", () => {
		const s = new SavingsTracker();
		const def = new CompressionPipeline(noMLSettings, s);
		expect(def.softThreshold).toBe(0.7);
		expect(def.softRecencyWindow).toBe(5);

		const custom = new CompressionPipeline(noMLSettings, s, { softThreshold: 0.5, softRecencyWindow: 3 });
		expect(custom.softThreshold).toBe(0.5);
		expect(custom.softRecencyWindow).toBe(3);
	});
});
