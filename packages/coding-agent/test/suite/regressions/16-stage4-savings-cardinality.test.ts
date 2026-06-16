/**
 * Regression for #16 stage 4 (CompressionPipeline extraction).
 *
 * Council A r2 BLOCKER #2: "Two writers to SavingsTracker for the same tool
 * result". The DD §10.1 invariant is "one net delta per tool result" — the
 * pipeline books `dedup` savings on the dedup short-circuit, and `AgentSession`
 * books `compression` savings + `recordToolOutput` for everything else.
 * Without a guard, a future change that adds savings booking inside the
 * pipeline's `compressToolResult` would silently double-count.
 *
 * This test pins the invariant: per non-error tool result the pipeline saw, the
 * tracker MUST receive exactly one denominator booking (`recordToolOutput`) and
 * at most one savings event (`dedup` OR `compression`, never both).
 */

import type { AgentTool } from "@juliusbrussee/caveman-agent";
import { fauxAssistantMessage, fauxToolCall } from "@juliusbrussee/caveman-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

describe("issue #16 stage 4 — savings booking cardinality", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("books exactly one denominator + at most one savings event per non-error tool result", async () => {
		// A tool whose output is large enough that rule-based compression has
		// something to chew on (small payloads no-op through every stage).
		const bigOutput = "line of output text\n".repeat(200);
		const echoTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Echo a fixed payload",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => ({
				content: [{ type: "text", text: bigOutput }],
				details: {},
			}),
		};

		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);

		// Spy on the SavingsTracker: count calls to `recordToolOutput` and
		// `recordSaving`. AgentSession exposes `savings` (the tracker instance).
		const tracker = harness.session.savings;
		const realRecordToolOutput = tracker.recordToolOutput.bind(tracker);
		const realRecordSaving = tracker.recordSaving.bind(tracker);
		const denominatorCalls: number[] = [];
		const savingCalls: Array<{ source: string; bytes: number }> = [];
		tracker.recordToolOutput = (bytes: number) => {
			denominatorCalls.push(bytes);
			realRecordToolOutput(bytes);
		};
		tracker.recordSaving = (source, bytes) => {
			savingCalls.push({ source, bytes });
			realRecordSaving(source, bytes);
		};

		harness.setResponses([
			// Drive ONE tool call, then a plain text reply.
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run it");

		// One non-error tool result was produced → exactly one denominator.
		expect(denominatorCalls.length).toBe(1);
		expect(denominatorCalls[0]).toBeGreaterThan(0);

		// At most one savings event for that result. Source must be `compression`
		// (no dedup possible: it's a bash call, not a read). `compaction` only
		// fires from soft compaction inside transformContext, which won't trigger
		// on a single-turn prompt below the soft threshold.
		expect(savingCalls.length).toBeLessThanOrEqual(1);
		if (savingCalls.length === 1) {
			expect(savingCalls[0].source).toBe("compression");
			expect(savingCalls[0].bytes).toBeGreaterThanOrEqual(0);
		}
	});

	it("books exactly one denominator + one dedup saving on a dedup-hit read (no compression event for the stub)", async () => {
		// A read tool whose output is large enough that the dedup stub is
		// SMALLER than the full content (otherwise the tracker clamps negative
		// deltas to 0 and the `dedup` event is suppressed — see test in
		// compression-pipeline.test.ts).
		const bigFile = "file line\n".repeat(500);
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Return the same large payload twice",
			parameters: Type.Object({ path: Type.String() }),
			execute: async () => ({
				content: [{ type: "text", text: bigFile }],
				details: {},
			}),
		};

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		const tracker = harness.session.savings;
		const realRecordToolOutput = tracker.recordToolOutput.bind(tracker);
		const realRecordSaving = tracker.recordSaving.bind(tracker);
		const denominatorCalls: number[] = [];
		const savingCalls: Array<{ source: string; bytes: number }> = [];
		tracker.recordToolOutput = (bytes: number) => {
			denominatorCalls.push(bytes);
			realRecordToolOutput(bytes);
		};
		tracker.recordSaving = (source, bytes) => {
			savingCalls.push({ source, bytes });
			realRecordSaving(source, bytes);
		};

		harness.setResponses([
			// Turn 1: read /a/b.txt → cache miss, full result + compression event.
			fauxAssistantMessage(fauxToolCall("read", { path: "/a/b.txt" }), { stopReason: "toolUse" }),
			// Turn 1 continuation: ask for the same file again → dedup hit.
			fauxAssistantMessage(fauxToolCall("read", { path: "/a/b.txt" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read it twice");

		// Two non-error reads → exactly two denominators. (Dedup hit also books
		// `recordToolOutput` via tryReadDedup so the honest-denominator covers
		// every result the model received, compressed or not.)
		expect(denominatorCalls.length).toBe(2);

		// Savings events: at most one per result. First read may or may not save
		// (rule-based compression on a uniform payload often no-ops). Second read
		// MUST save (it's a guaranteed dedup hit). Either way, total events ≤ 2.
		expect(savingCalls.length).toBeLessThanOrEqual(2);

		// At least one dedup event for the second read (file is much larger than
		// the stub text so the delta is positive — see fixture sizing above).
		const dedupEvents = savingCalls.filter((s) => s.source === "dedup");
		expect(dedupEvents.length).toBe(1);
		expect(dedupEvents[0].bytes).toBeGreaterThan(0);

		// No dedup-and-compression for the same result. The dedup short-circuit
		// in AgentSession.afterToolCall returns early; the compression branch
		// never runs on the dedup-hit result. So compression events count <= 1
		// (for the first read only).
		const compressionEvents = savingCalls.filter((s) => s.source === "compression");
		expect(compressionEvents.length).toBeLessThanOrEqual(1);
	});
});
