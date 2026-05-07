// WS6: Subagents — runtime helper tests.
//
// Covers:
//   - validateSubagentDef rejects missing/invalid fields
//   - normalizeFrontmatterArray handles array + comma-string + bad input
//   - MAX_PARALLEL_SUBAGENTS = 7 (Claude Code parity)
//   - computeAllowedTools intersects parent tools, frontmatter tools, and
//     disallowedTools correctly

import { describe, expect, it } from "vitest";
import {
	computeAllowedTools,
	findSubagent,
	MAX_PARALLEL_SUBAGENTS,
	normalizeFrontmatterArray,
	type SubagentDef,
	validateSubagentDef,
	validateSubagentOutput,
} from "../subagent.js";

const baseDef = (over: Partial<SubagentDef> = {}): SubagentDef => ({
	name: "explore",
	description: "test",
	prompt: "body",
	source: "user",
	filePath: "/tmp/explore.md",
	...over,
});

describe("MAX_PARALLEL_SUBAGENTS", () => {
	it("equals 7 (Claude Code parity, plan §6)", () => {
		expect(MAX_PARALLEL_SUBAGENTS).toBe(7);
	});
});

describe("validateSubagentDef", () => {
	it("accepts a minimal valid def", () => {
		expect(validateSubagentDef(baseDef())).toEqual([]);
	});

	it("requires name, description, prompt", () => {
		const errors = validateSubagentDef({} as Partial<SubagentDef>);
		expect(errors).toContain("name is required");
		expect(errors).toContain("description is required");
		expect(errors).toContain("prompt body is required (markdown file body after frontmatter)");
	});

	it("rejects names with invalid characters", () => {
		const errors = validateSubagentDef(baseDef({ name: "FOO_BAR" }));
		expect(errors.some((e) => e.includes("invalid characters"))).toBe(true);
	});

	it("rejects leading/trailing hyphens", () => {
		const lead = validateSubagentDef(baseDef({ name: "-foo" }));
		expect(lead.some((e) => e.includes("invalid characters"))).toBe(true);
		const trail = validateSubagentDef(baseDef({ name: "foo-" }));
		expect(trail.some((e) => e.includes("invalid characters"))).toBe(true);
	});

	it("accepts hyphenated names", () => {
		expect(validateSubagentDef(baseDef({ name: "code-reviewer" }))).toEqual([]);
	});

	it("rejects names exceeding 64 characters", () => {
		const longName = "a".repeat(65);
		const errors = validateSubagentDef(baseDef({ name: longName }));
		expect(errors.some((e) => e.startsWith("name exceeds 64"))).toBe(true);
	});

	it("rejects descriptions exceeding 1024 characters", () => {
		const errors = validateSubagentDef(baseDef({ description: "x".repeat(1025) }));
		expect(errors.some((e) => e.startsWith("description exceeds 1024"))).toBe(true);
	});

	it("validates isolation against the union", () => {
		expect(validateSubagentDef(baseDef({ isolation: "worktree" }))).toEqual([]);
		expect(validateSubagentDef(baseDef({ isolation: "none" }))).toEqual([]);
		const bad = validateSubagentDef(baseDef({ isolation: "docker" as any }));
		expect(bad.some((e) => e.startsWith('isolation "docker"'))).toBe(true);
	});

	it("validates maxTurns is positive finite", () => {
		expect(validateSubagentDef(baseDef({ maxTurns: 10 }))).toEqual([]);
		expect(
			validateSubagentDef(baseDef({ maxTurns: 0 })).some((e) => e.startsWith("maxTurns must be a positive")),
		).toBe(true);
		expect(
			validateSubagentDef(baseDef({ maxTurns: -1 })).some((e) => e.startsWith("maxTurns must be a positive")),
		).toBe(true);
		expect(
			validateSubagentDef(baseDef({ maxTurns: Number.NaN })).some((e) =>
				e.startsWith("maxTurns must be a positive"),
			),
		).toBe(true);
	});
});

describe("normalizeFrontmatterArray", () => {
	it("returns undefined for null/undefined", () => {
		expect(normalizeFrontmatterArray(undefined)).toBeUndefined();
		expect(normalizeFrontmatterArray(null)).toBeUndefined();
	});

	it("passes through arrays of strings", () => {
		expect(normalizeFrontmatterArray(["read", "grep"])).toEqual(["read", "grep"]);
	});

	it("splits comma strings", () => {
		expect(normalizeFrontmatterArray("read, grep,find")).toEqual(["read", "grep", "find"]);
	});

	it("filters empties", () => {
		expect(normalizeFrontmatterArray(",, read,, ,grep ")).toEqual(["read", "grep"]);
	});

	it("returns undefined for non-array non-string", () => {
		expect(normalizeFrontmatterArray(42)).toBeUndefined();
		expect(normalizeFrontmatterArray({})).toBeUndefined();
	});
});

describe("computeAllowedTools", () => {
	const PARENT = ["read", "grep", "find", "ls", "bash", "edit", "write"];

	it("returns parent tools when no frontmatter scoping", () => {
		expect(computeAllowedTools({ parentTools: PARENT })).toEqual(PARENT);
	});

	it("intersects with frontmatter tools", () => {
		expect(computeAllowedTools({ parentTools: PARENT, frontmatterTools: ["read", "grep"] })).toEqual([
			"read",
			"grep",
		]);
	});

	it("subtracts disallowedTools after the intersect", () => {
		expect(
			computeAllowedTools({
				parentTools: PARENT,
				frontmatterTools: ["read", "grep", "bash"],
				frontmatterDisallowed: ["bash"],
			}),
		).toEqual(["read", "grep"]);
	});
});

describe("findSubagent + validateSubagentOutput", () => {
	it("findSubagent returns matching def or undefined", () => {
		const defs = [baseDef({ name: "alpha" }), baseDef({ name: "beta" })];
		expect(findSubagent(defs, "alpha")?.name).toBe("alpha");
		expect(findSubagent(defs, "missing")).toBeUndefined();
	});

	it("validateSubagentOutput is a P1 stub returning ok=true", () => {
		const out = validateSubagentOutput(baseDef(), { anything: 42 });
		expect(out.ok).toBe(true);
	});
});
