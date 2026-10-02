import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeBudget } from "../src/core/hooks/scope-budget.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workdir(): string {
	const dir = mkdtempSync(join(tmpdir(), "scope-budget-"));
	dirs.push(dir);
	return dir;
}

describe("ScopeBudget", () => {
	it("allows routine edits and ignores other agents' files", () => {
		const cwd = workdir();
		const budget = new ScopeBudget(cwd);
		for (let i = 0; i < 10; i++) writeFileSync(join(cwd, `other-${i}.ts`), "other\n");
		expect(budget.reserve("one", "write", { path: "own.ts", content: "code\n" })).toBeUndefined();
	});

	it("blocks a fifth new file but allows reducing an existing change", () => {
		const cwd = workdir();
		const budget = new ScopeBudget(cwd);
		for (let i = 0; i < 4; i++) {
			const path = `new-${i}.ts`;
			expect(budget.reserve(path, "write", { path, content: "new\n" })).toBeUndefined();
			writeFileSync(join(cwd, path), "new\n");
			budget.finish(path, true);
		}
		expect(budget.reserve("fifth", "write", { path: "fifth.ts", content: "x\n" })).toContain("Scope budget reached");
		expect(
			budget.reserve("fix", "edit", { path: "new-0.ts", edits: [{ oldText: "new", newText: "" }] }),
		).toBeUndefined();
	});

	it("blocks a ninth changed file even when all files already exist", () => {
		const cwd = workdir();
		const budget = new ScopeBudget(cwd);
		for (let i = 0; i < 9; i++) writeFileSync(join(cwd, `existing-${i}.ts`), "old\n");
		for (let i = 0; i < 8; i++) {
			const path = `existing-${i}.ts`;
			expect(budget.reserve(path, "edit", { path, edits: [{ oldText: "old", newText: "new" }] })).toBeUndefined();
			budget.finish(path, true);
		}
		expect(budget.reserve("nine", "edit", { path: "existing-8.ts", edits: [] })).toContain("Scope budget reached");
	});

	it("blocks proposed edits over 300 added lines", () => {
		const cwd = workdir();
		writeFileSync(join(cwd, "existing.ts"), "old\n");
		const budget = new ScopeBudget(cwd);
		expect(budget.reserve("large", "write", { path: "new.ts", content: "line\n".repeat(301) })).toContain(
			"+301 lines",
		);
		expect(
			budget.reserve("edit", "edit", {
				path: "existing.ts",
				edits: [{ oldText: "old", newText: "line\n".repeat(302) }],
			}),
		).toContain("Scope budget reached");
	});

	it("does not grow an already-touched file past 300 added lines", () => {
		const cwd = workdir();
		const budget = new ScopeBudget(cwd);
		expect(budget.reserve("first", "write", { path: "new.ts", content: "line\n".repeat(300) })).toBeUndefined();
		writeFileSync(join(cwd, "new.ts"), "line\n".repeat(300));
		budget.finish("first", true);
		expect(
			budget.reserve("grow", "edit", { path: "new.ts", edits: [{ oldText: "", newText: "extra\n" }] }),
		).toContain("Scope budget reached");
		expect(
			budget.reserve("shrink", "edit", { path: "new.ts", edits: [{ oldText: "line\n", newText: "" }] }),
		).toBeUndefined();
	});

	it("releases failed calls and counts pending calls", () => {
		const budget = new ScopeBudget(workdir());
		expect(budget.reserve("failed", "write", { path: "failed.ts", content: "line\n" })).toBeUndefined();
		budget.finish("failed", false);
		for (let i = 0; i < 4; i++) {
			expect(budget.reserve(String(i), "write", { path: `${i}.ts`, content: "line\n" })).toBeUndefined();
		}
		expect(budget.reserve("fifth", "write", { path: "fifth.ts", content: "x\n" })).toContain("Scope budget reached");
	});

	it("handles a session started in a subdirectory", () => {
		const cwd = workdir();
		mkdirSync(join(cwd, "src"));
		const budget = new ScopeBudget(join(cwd, "src"));
		expect(budget.reserve("one", "write", { path: "new.ts", content: "line\n" })).toBeUndefined();
		expect(budget.reserve("outside", "write", { path: "../other.ts", content: "line\n" })).toBeUndefined();
	});
});
