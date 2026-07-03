import { describe, expect, it } from "vitest";
import { buildContextLearnPreview } from "../src/core/context-learn.js";

describe("context learn preview", () => {
	it("returns guidance when no assistant text exists", () => {
		const preview = buildContextLearnPreview({ sessionId: "s1", cwd: "/repo" });

		expect(preview).toContain("No assistant summary available");
		expect(preview).toContain("/memory save <fact>");
	});

	it("redacts obvious secrets and never writes", () => {
		const preview = buildContextLearnPreview({
			sessionId: "s1",
			cwd: "/repo",
			lastAssistantText: "Use token=ghp_abcdefghijklmnopqrstuvwxyz and api_key: sk-abc1234567890000",
		});

		expect(preview).toContain("token: [REDACTED]");
		expect(preview).toContain("api_key: [REDACTED]");
		expect(preview).toContain("Nothing has been written");
	});

	it("truncates long previews", () => {
		const preview = buildContextLearnPreview({
			sessionId: "s1",
			cwd: "/repo",
			lastAssistantText: "x".repeat(2000),
		});

		expect(preview.length).toBeLessThan(1500);
		expect(preview).toContain("…");
	});
});
