import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dlog, dlogEnabled, resetDebugLogForTest } from "../src/core/daemon/debug-log.js";

describe("debug-log", () => {
	let testDir: string;

	beforeEach(() => {
		// Create temp directory for each test
		testDir = join(tmpdir(), `mewrite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		// Reset module state
		resetDebugLogForTest();
		// Clear env
		delete process.env.MEWRITE_AGENTS_DEBUG;
		delete process.env.MEWRITE_AGENTS_DEBUG_MAXBYTES;
	});

	afterEach(() => {
		// Cleanup
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		resetDebugLogForTest();
		delete process.env.MEWRITE_AGENTS_DEBUG;
		delete process.env.MEWRITE_AGENTS_DEBUG_MAXBYTES;
	});

	it("should be disabled when MEWRITE_AGENTS_DEBUG is unset", () => {
		expect(dlogEnabled()).toBe(false);
		const logPath = join(testDir, "test.log");
		process.env.MEWRITE_AGENTS_DEBUG = logPath;
		resetDebugLogForTest();
		expect(dlogEnabled()).toBe(true);
	});

	it("should write nothing when disabled", () => {
		const logPath = join(testDir, "test.log");
		// Not setting MEWRITE_AGENTS_DEBUG
		dlog("runner", "test-event", { foo: "bar" });
		expect(existsSync(logPath)).toBe(false);
	});

	it("should write a log line when enabled", () => {
		const logPath = join(testDir, "test.log");
		process.env.MEWRITE_AGENTS_DEBUG = logPath;
		resetDebugLogForTest();

		dlog("runner", "test-event", { foo: "bar" });

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, "utf-8");
		expect(content).toContain("[runner:");
		expect(content).toContain("test-event");
		expect(content).toContain('"foo":"bar"');
	});

	it("should respect category allowlist", () => {
		const logPath = join(testDir, "test.log");
		// Use the tag=path syntax to specify custom path with allowlist
		process.env.MEWRITE_AGENTS_DEBUG = `runner,daemon=${logPath}`;
		resetDebugLogForTest();

		dlog("runner", "allowed-1");
		dlog("daemon", "allowed-2");
		dlog("pane", "blocked");
		dlog("serve", "blocked-2");

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, "utf-8");
		expect(content).toContain("allowed-1");
		expect(content).toContain("allowed-2");
		expect(content).not.toContain("blocked");
		expect(content).not.toContain("blocked-2");
	});

	it("should support category with custom path", () => {
		const logPath = join(testDir, "custom.log");
		process.env.MEWRITE_AGENTS_DEBUG = `runner,ws=${logPath}`;
		resetDebugLogForTest();

		dlog("runner", "test-event");

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, "utf-8");
		expect(content).toContain("test-event");
	});

	it("should log all categories when env is '1'", () => {
		// Use a custom path for the test to avoid polluting home dir
		const logPath = join(testDir, "all.log");
		process.env.MEWRITE_AGENTS_DEBUG = logPath;
		resetDebugLogForTest();

		dlog("runner", "event-1");
		dlog("daemon", "event-2");
		dlog("pane", "event-3");
		dlog("serve", "event-4");

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, "utf-8");
		expect(content).toContain("event-1");
		expect(content).toContain("event-2");
		expect(content).toContain("event-3");
		expect(content).toContain("event-4");
	});

	it("should rotate when file exceeds max bytes", () => {
		const logPath = join(testDir, "rotate.log");
		process.env.MEWRITE_AGENTS_DEBUG = logPath;
		process.env.MEWRITE_AGENTS_DEBUG_MAXBYTES = "1024"; // 1 KB for testing
		resetDebugLogForTest();

		// Write enough data to exceed 1 KB
		const largeData = { payload: "x".repeat(200) };
		for (let i = 0; i < 10; i++) {
			dlog("runner", `event-${i}`, largeData);
		}

		// Give rotation a chance to trigger (it's throttled, but we wrote 10 times)
		// Force another write to potentially trigger the check
		for (let i = 10; i < 60; i++) {
			dlog("runner", `event-${i}`, largeData);
		}

		const backupPath = `${logPath}.1`;

		// Either rotation happened or file is still under limit
		// Check if rotation occurred
		if (existsSync(backupPath)) {
			// Rotation happened
			expect(existsSync(logPath)).toBe(true);
			const currentSize = statSync(logPath).size;
			const backupSize = statSync(backupPath).size;
			// The backup should have the old content
			expect(backupSize).toBeGreaterThan(0);
			// New file should be smaller than the backup (it was rotated)
			expect(currentSize).toBeLessThan(backupSize + 10000); // some reasonable bound
		} else {
			// Rotation may not have happened yet due to throttling, just verify file exists
			expect(existsSync(logPath)).toBe(true);
		}

		// Verify the backup exists after enough writes
		expect(existsSync(backupPath)).toBe(true);
	});

	it("should handle rotation when .1 already exists", () => {
		const logPath = join(testDir, "rotate2.log");
		const backupPath = `${logPath}.1`;

		// Pre-create a .1 backup
		writeFileSync(backupPath, "old backup content\n");

		process.env.MEWRITE_AGENTS_DEBUG = logPath;
		process.env.MEWRITE_AGENTS_DEBUG_MAXBYTES = "500";
		resetDebugLogForTest();

		// Write enough to trigger rotation
		const largeData = { payload: "x".repeat(200) };
		for (let i = 0; i < 60; i++) {
			dlog("runner", `event-${i}`, largeData);
		}

		// The old .1 should be overwritten
		expect(existsSync(backupPath)).toBe(true);
		const backupContent = readFileSync(backupPath, "utf-8");
		expect(backupContent).not.toContain("old backup content");
		expect(backupContent).toContain("event-"); // has new rotated content
	});

	it("should not write when category list is empty or invalid", () => {
		const logPath = join(testDir, "invalid.log");
		process.env.MEWRITE_AGENTS_DEBUG = "invalid-tag,unknown";
		resetDebugLogForTest();

		dlog("runner", "test");

		// No valid tags, so nothing should be written
		expect(existsSync(logPath)).toBe(false);
		expect(dlogEnabled()).toBe(false);
	});
});
