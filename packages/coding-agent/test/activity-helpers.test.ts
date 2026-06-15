import { describe, expect, test } from "vitest";
import { detailOf, kindOf, labelOf } from "../src/modes/interactive/activity-helpers.js";

describe("kindOf", () => {
	test("subagent tool names map to 'subagent'", () => {
		expect(kindOf("task")).toBe("subagent");
		expect(kindOf("agent")).toBe("subagent");
	});

	test("everything else maps to 'tool'", () => {
		expect(kindOf("bash")).toBe("tool");
		expect(kindOf("read")).toBe("tool");
		expect(kindOf("some_mcp_tool")).toBe("tool");
	});
});

describe("labelOf", () => {
	test("plain tools use the tool name", () => {
		expect(labelOf("bash", {})).toBe("bash");
	});

	test("subagent uses the agent name when present", () => {
		expect(labelOf("task", { agent: "explorer" })).toBe("explorer");
	});

	test("subagent batch tasks show first agent + count", () => {
		expect(labelOf("task", { tasks: [{ agent: "a" }, { agent: "b" }] })).toBe("a +1");
	});

	test("subagent chain shows chain prefix + count", () => {
		expect(labelOf("agent", { chain: [{ agent: "a" }, { agent: "b" }, { agent: "c" }] })).toBe("chain:a +2");
	});

	test("subagent with no derivable agent falls back to 'task'", () => {
		expect(labelOf("task", {})).toBe("task");
	});
});

describe("detailOf", () => {
	test("bash uses the command, truncated", () => {
		expect(detailOf("bash", { command: "echo hi" })).toBe("echo hi");
	});

	test("file tools use path / file_path", () => {
		expect(detailOf("read", { path: "/a/b.ts" })).toBe("/a/b.ts");
		expect(detailOf("read", { file_path: "/a/c.ts" })).toBe("/a/c.ts");
	});

	test("returns undefined when no detail is derivable", () => {
		expect(detailOf("read", {})).toBeUndefined();
		expect(detailOf("bash", {})).toBeUndefined();
	});

	test("truncates long details to 80 chars with an ellipsis", () => {
		const long = "x".repeat(200);
		const out = detailOf("bash", { command: long });
		expect(out).toBeDefined();
		expect(out?.length).toBe(80);
		expect(out?.endsWith("…")).toBe(true);
	});
});
