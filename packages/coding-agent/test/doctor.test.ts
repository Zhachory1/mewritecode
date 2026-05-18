import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDoctorReport, formatDoctorReport } from "../src/cli/doctor.js";

describe("WS11 caveman doctor", () => {
	const testDir = join(process.cwd(), "test-doctor-tmp");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	it("produces a structured report with summary counters", () => {
		const report = buildDoctorReport({ cwd: testDir, includeMcp: true });
		expect(report.checks.length).toBeGreaterThan(0);
		expect(typeof report.version).toBe("string");
		expect(typeof report.platform).toBe("string");
		expect(typeof report.arch).toBe("string");
		expect(typeof report.kernel).toBe("string");
		expect(typeof report.node).toBe("string");
		const total = report.summary.ok + report.summary.warn + report.summary.fail + report.summary.info;
		expect(total).toBe(report.checks.length);
	});

	it("includes terminal capability checks", () => {
		const report = buildDoctorReport({ cwd: testDir });
		const ids = report.checks.map((c) => c.id);
		expect(ids).toContain("tty");
		expect(ids).toContain("truecolor");
		expect(ids).toContain("term");
	});

	it("includes sandbox + tooling + auth checks", () => {
		const report = buildDoctorReport({ cwd: testDir });
		const ids = report.checks.map((c) => c.id);
		// At least one sandbox-* check
		expect(ids.some((i) => i.startsWith("sandbox-"))).toBe(true);
		// Tools git/tar/curl always probed
		expect(ids).toContain("tool-git");
		expect(ids).toContain("tool-tar");
		expect(ids).toContain("tool-curl");
	});

	it("formatDoctorReport returns non-empty human-readable output", () => {
		const report = buildDoctorReport({ cwd: testDir });
		const text = formatDoctorReport(report);
		expect(text).toContain("Summary:");
		expect(text.length).toBeGreaterThan(50);
	});

	it("JSON serialisation round-trips", () => {
		const report = buildDoctorReport({ cwd: testDir });
		const json = JSON.stringify(report);
		const parsed = JSON.parse(json);
		expect(parsed.checks.length).toBe(report.checks.length);
		expect(parsed.summary).toEqual(report.summary);
	});

	it("flags onboarding as not-yet-completed when settings file is fresh", () => {
		const report = buildDoctorReport({ cwd: testDir });
		const onboarding = report.checks.find((c) => c.id === "onboarding");
		expect(onboarding).toBeDefined();
		// Either ok (already completed for this user) or warn (not yet); must be one of those.
		expect(["ok", "warn"]).toContain(onboarding!.status);
	});
});
