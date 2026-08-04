import { afterEach, describe, expect, it } from "vitest";
import { resolveCompactionIdleTimeoutMs } from "../src/core/compaction/compaction.js";

const ENV_KEY = "CAVE_COMPACTION_IDLE_TIMEOUT_MS";

describe("compaction idle-timeout resolution", () => {
	afterEach(() => {
		delete process.env[ENV_KEY];
	});

	it("defaults to 30000ms when the env override is unset", () => {
		delete process.env[ENV_KEY];
		expect(resolveCompactionIdleTimeoutMs()).toBe(30_000);
	});

	it("honors a valid env override", () => {
		process.env[ENV_KEY] = "5000";
		expect(resolveCompactionIdleTimeoutMs()).toBe(5000);
	});

	it("allows 0 to disable the watchdog", () => {
		process.env[ENV_KEY] = "0";
		expect(resolveCompactionIdleTimeoutMs()).toBe(0);
	});

	it("falls back to the default on a garbage or negative override", () => {
		process.env[ENV_KEY] = "not-a-number";
		expect(resolveCompactionIdleTimeoutMs()).toBe(30_000);
		process.env[ENV_KEY] = "-1";
		expect(resolveCompactionIdleTimeoutMs()).toBe(30_000);
	});
});
