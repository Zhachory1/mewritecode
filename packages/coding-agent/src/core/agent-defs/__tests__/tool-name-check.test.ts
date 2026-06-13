import { describe, expect, it } from "vitest";
import { classifyToolName, effectiveTools, isIncompleteWriteSet } from "../tool-name-check.js";

describe("classifyToolName", () => {
	it("returns null for a known tool name", () => {
		expect(classifyToolName("write")).toBeNull();
	});

	it("suggests the canonical name for a case-mismatched tool (did-you-mean)", () => {
		expect(classifyToolName("Write")).toEqual({ kind: "did-you-mean", name: "Write", suggestion: "write" });
	});

	it("suggests the canonical name for an upper-cased ls", () => {
		expect(classifyToolName("LS")).toEqual({ kind: "did-you-mean", name: "LS", suggestion: "ls" });
	});

	it("returns null for an mcp__ prefixed dynamic tool", () => {
		expect(classifyToolName("mcp__x__y")).toBeNull();
	});

	it("returns null for a memory_ prefixed dynamic tool", () => {
		expect(classifyToolName("memory_save")).toBeNull();
	});

	it("flags a typo'd tool as unknown", () => {
		expect(classifyToolName("wirte")).toEqual({ kind: "unknown", name: "wirte" });
	});

	it("flags an unrelated tool name as unknown", () => {
		expect(classifyToolName("str_replace")).toEqual({ kind: "unknown", name: "str_replace" });
	});
});

describe("isIncompleteWriteSet", () => {
	it("is true when edit+write present with no locate tool", () => {
		expect(isIncompleteWriteSet(["edit", "write"])).toBe(true);
	});

	it("is false when a locate tool (read) is present", () => {
		expect(isIncompleteWriteSet(["edit", "read"])).toBe(false);
	});

	it("is false when there is no write tool", () => {
		expect(isIncompleteWriteSet(["bash"])).toBe(false);
	});

	it("is false when a locate tool (grep) accompanies write", () => {
		expect(isIncompleteWriteSet(["write", "grep"])).toBe(false);
	});

	it("is false when bash (superset) accompanies write", () => {
		expect(isIncompleteWriteSet(["bash", "write"])).toBe(false);
	});

	it("is false for an empty set", () => {
		expect(isIncompleteWriteSet([])).toBe(false);
	});
});

describe("effectiveTools", () => {
	it("subtracts disallowedTools from tools", () => {
		expect(effectiveTools(["read", "edit"], ["read"])).toEqual(["edit"]);
	});

	it("flags the disallow-defeats-locate case as incomplete", () => {
		expect(isIncompleteWriteSet(effectiveTools(["read", "edit"], ["read"]))).toBe(true);
	});
});
