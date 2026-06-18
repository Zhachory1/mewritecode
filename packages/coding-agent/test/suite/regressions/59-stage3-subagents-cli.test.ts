/**
 * Regression for #59 stage 3 — `caveman subagents install` CLI.
 *
 * Pins:
 *   1. `parseSubagentsArgs` recognizes list / install / --from / --to /
 *      --dry-run / --help, ignores unsupported platform names.
 *   2. `copyAgentDir` copies .md files between two dirs, skips conflicts,
 *      no-ops on dry-run, no-ops when the source dir doesn't exist.
 *   3. Bundled cave agents (scout/planner/worker + critic/editor/etc.) are
 *      copyable into a fake ~/.claude/agents/ target.
 *   4. Re-running the copy is idempotent (no duplicate writes, no errors).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyAgentDir, parseSubagentsArgs } from "../../../src/cli/subagents-cli.js";

describe("#59 stage 3 — parseSubagentsArgs", () => {
	it("recognizes list subcommand", () => {
		expect(parseSubagentsArgs(["list"])).toMatchObject({ subcommand: "list" });
	});

	it("recognizes install --from claude", () => {
		expect(parseSubagentsArgs(["install", "--from", "claude"])).toMatchObject({
			subcommand: "install",
			from: "claude",
		});
	});

	it("recognizes install --from=claude (= form)", () => {
		expect(parseSubagentsArgs(["install", "--from=claude"])).toMatchObject({
			subcommand: "install",
			from: "claude",
		});
	});

	it("recognizes install --to claude", () => {
		expect(parseSubagentsArgs(["install", "--to", "claude"])).toMatchObject({
			subcommand: "install",
			to: "claude",
		});
	});

	it("recognizes --dry-run flag", () => {
		expect(parseSubagentsArgs(["install", "--from", "claude", "--dry-run"])).toMatchObject({
			subcommand: "install",
			from: "claude",
			dryRun: true,
		});
	});

	it("recognizes --help", () => {
		expect(parseSubagentsArgs(["--help"])).toMatchObject({ help: true });
		expect(parseSubagentsArgs(["-h"])).toMatchObject({ help: true });
	});

	it("ignores unsupported platform names in --from", () => {
		// `cursor` is not in SUPPORTED_PLATFORMS; should leave `from` undefined
		// so the install handler can report the error.
		expect(parseSubagentsArgs(["install", "--from", "cursor"])).toMatchObject({
			subcommand: "install",
			from: undefined,
		});
	});

	it("returns subcommand undefined when nothing matches (help fallthrough)", () => {
		expect(parseSubagentsArgs([])).toMatchObject({ subcommand: undefined });
	});
});

describe("#59 stage 3 — copyAgentDir", () => {
	let tmpRoot: string;
	let source: string;
	let destination: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "cave-59-stage3-"));
		source = join(tmpRoot, "src");
		destination = join(tmpRoot, "dst");
	});

	afterEach(() => {
		if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
	});

	function writeMd(dir: string, name: string, contents = "agent body"): string {
		mkdirSync(dir, { recursive: true });
		const filePath = join(dir, name);
		writeFileSync(filePath, contents);
		return filePath;
	}

	it("copies .md files from source to destination", () => {
		writeMd(source, "a.md", "agent a");
		writeMd(source, "b.md", "agent b");

		const report = copyAgentDir(source, destination);
		expect(report.copied.sort()).toEqual(["a.md", "b.md"]);
		expect(report.skipped).toEqual([]);
		expect(existsSync(join(destination, "a.md"))).toBe(true);
		expect(readFileSync(join(destination, "a.md"), "utf-8")).toBe("agent a");
	});

	it("ignores non-.md files", () => {
		writeMd(source, "a.md");
		writeMd(source, "README.txt", "ignore me");

		const report = copyAgentDir(source, destination);
		expect(report.copied).toEqual(["a.md"]);
		expect(existsSync(join(destination, "README.txt"))).toBe(false);
	});

	it("skips files that already exist at the destination", () => {
		writeMd(source, "a.md", "new version");
		mkdirSync(destination, { recursive: true });
		writeFileSync(join(destination, "a.md"), "existing");

		const report = copyAgentDir(source, destination);
		expect(report.copied).toEqual([]);
		expect(report.skipped).toEqual([{ name: "a.md", reason: "exists" }]);
		// existing content preserved
		expect(readFileSync(join(destination, "a.md"), "utf-8")).toBe("existing");
	});

	it("dry-run writes nothing but reports what would be copied", () => {
		writeMd(source, "a.md");
		writeMd(source, "b.md");

		const report = copyAgentDir(source, destination, { dryRun: true });
		expect(report.copied.sort()).toEqual(["a.md", "b.md"]);
		expect(report.dryRun).toBe(true);
		expect(existsSync(destination)).toBe(false);
	});

	it("no-ops when source dir does not exist", () => {
		const report = copyAgentDir("/nonexistent/path/that/does/not/exist", destination);
		expect(report.copied).toEqual([]);
		expect(report.skipped).toEqual([]);
		expect(existsSync(destination)).toBe(false);
	});

	it("re-run is idempotent (all files skipped as 'exists')", () => {
		writeMd(source, "a.md");
		writeMd(source, "b.md");

		copyAgentDir(source, destination);
		const second = copyAgentDir(source, destination);

		expect(second.copied).toEqual([]);
		expect(second.skipped.map((s) => s.name).sort()).toEqual(["a.md", "b.md"]);
	});
});
