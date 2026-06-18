// Round-trip tests for the Claude Code MEMORY.md bridge.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory } from "@zhachory1/mewrite-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { FilesProvider } = memory;

import { composeStartupPrelude, importFromClaudeCode, locateClaudeMemory, readMemoryIndex } from "../memory-bridge.js";

describe("MEMORY.md bridge", () => {
	let homeDir: string;
	let projectsDir: string;
	let memDir: string;
	let cwd: string;

	beforeEach(() => {
		homeDir = mkdtempSync(join(tmpdir(), "cave-home-"));
		projectsDir = join(homeDir, ".claude", "projects");
		// Use a synthetic cwd so the slug is stable across machines.
		cwd = "/tmp/cave-bridge-test-fixture";
		const slug = cwd.replace(/[/:]+/g, "-");
		memDir = join(projectsDir, slug, "memory");
		mkdirSync(memDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(homeDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("locateClaudeMemory returns exists=true for a real dir", () => {
		writeFileSync(join(memDir, "MEMORY.md"), "# Index\n");
		const loc = locateClaudeMemory(cwd, homeDir);
		expect(loc.exists).toBe(true);
		expect(loc.indexFile.endsWith("MEMORY.md")).toBe(true);
	});

	it("locateClaudeMemory returns exists=false when the dir is missing", () => {
		const loc = locateClaudeMemory("/totally/unrelated", homeDir);
		expect(loc.exists).toBe(false);
	});

	it("readMemoryIndex returns first N lines", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
		writeFileSync(join(memDir, "MEMORY.md"), lines);
		const loc = locateClaudeMemory(cwd, homeDir);
		const got = readMemoryIndex(loc, { lines: 3 });
		expect(got).toBe("line 1\nline 2\nline 3");
	});

	it("readMemoryIndex returns undefined when file missing", () => {
		const loc = locateClaudeMemory(cwd, homeDir);
		expect(readMemoryIndex(loc)).toBeUndefined();
	});

	it("importFromClaudeCode round-trips per-fact .md files into a provider", async () => {
		writeFileSync(join(memDir, "MEMORY.md"), "# Index\n- [a](a.md)\n- [b](b.md)\n");
		writeFileSync(join(memDir, "a.md"), "Fact about A — preserve verbatim.");
		writeFileSync(join(memDir, "b.md"), "Fact about B with code: `npm install`.");
		writeFileSync(join(memDir, "duplicate-of-a.md"), "Fact about A — preserve verbatim.");

		const filesDir = mkdtempSync(join(tmpdir(), "cave-bridge-files-"));
		try {
			const provider = new FilesProvider({ memoryDir: filesDir });
			const loc = locateClaudeMemory(cwd, homeDir);
			const result = await importFromClaudeCode(loc, provider);
			// 2 unique facts (a + b); duplicate-of-a collapses by hash.
			expect(result.imported).toBe(2);
			expect(result.skipped).toBe(1);
			expect(result.errors).toEqual([]);
			expect(provider.stats().entries).toBe(2);

			// Searching for "Fact about A" should return our imported observation.
			const hits = await provider.search("Fact about A");
			expect(hits.length).toBeGreaterThanOrEqual(1);
		} finally {
			rmSync(filesDir, { recursive: true, force: true });
		}
	});

	it("importFromClaudeCode returns an error when the dir is missing", async () => {
		const provider = new FilesProvider({ memoryDir: mkdtempSync(join(tmpdir(), "cave-bridge-empty-")) });
		const loc = locateClaudeMemory("/no/such/dir", homeDir);
		const result = await importFromClaudeCode(loc, provider);
		expect(result.imported).toBe(0);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("composeStartupPrelude wraps inputs in <system-reminder>", () => {
		const out = composeStartupPrelude({
			memoryIndex: "first 200 lines\nfrom MEMORY.md",
			cavememSnippet: "[memory] hit #1 hello",
		});
		expect(out.startsWith("<system-reminder>")).toBe(true);
		expect(out).toContain("MEMORY.md");
		expect(out).toContain("[memory]");
		expect(out.endsWith("</system-reminder>")).toBe(true);
	});

	it("composeStartupPrelude returns empty string with no inputs", () => {
		expect(composeStartupPrelude({})).toBe("");
	});

	it("composeStartupPrelude truncates oversize bodies", () => {
		const big = "x".repeat(5_000);
		const out = composeStartupPrelude({ memoryIndex: big, maxChars: 200 });
		expect(out.length).toBeLessThan(300);
		expect(out).toContain("…");
	});
});
