import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";
import {
	detectAvailableEnvProviders,
	persistAnswers,
	runOnboarding,
	shouldRunOnboarding,
	type WizardAnswers,
	type WizardIO,
} from "../src/onboarding/wizard.js";

describe("WS11 onboarding wizard", () => {
	const testDir = join(process.cwd(), "test-onboarding-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".cave"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	function makeSettings() {
		return SettingsManager.create(projectDir, agentDir);
	}

	function makeIO(
		answers: string[],
		envKeys: Record<string, string> = {},
	): WizardIO & { capturedOut: () => string; remaining: () => string[] } {
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const queue = [...answers];
		const chunks: Buffer[] = [];
		stdout.on("data", (c) => chunks.push(Buffer.from(c)));
		return {
			stdin,
			stdout,
			stderr,
			envProbe: (provider: string) => envKeys[provider],
			prompt: async () => queue.shift() ?? "",
			capturedOut: () => Buffer.concat(chunks).toString("utf8"),
			remaining: () => queue.slice(),
		} as WizardIO & { capturedOut: () => string; remaining: () => string[] };
	}

	describe("detectAvailableEnvProviders", () => {
		it("returns providers with non-empty env keys", () => {
			const result = detectAvailableEnvProviders({
				stdin: process.stdin,
				stdout: process.stdout,
				stderr: process.stderr,
				envProbe: (p) => (p === "anthropic" ? "sk-ant-test" : p === "openai" ? "sk-openai" : undefined),
			});
			expect(result.map((r) => r.id).sort()).toEqual(["anthropic", "openai"]);
		});

		it("returns empty when no env keys set", () => {
			const result = detectAvailableEnvProviders({
				stdin: process.stdin,
				stdout: process.stdout,
				stderr: process.stderr,
				envProbe: () => undefined,
			});
			expect(result).toEqual([]);
		});
	});

	describe("shouldRunOnboarding", () => {
		it("returns true on first run with TTY", () => {
			const settings = makeSettings();
			const io: WizardIO = {
				stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
				stdout: process.stdout,
				stderr: process.stderr,
			};
			expect(shouldRunOnboarding(settings, io)).toBe(true);
		});

		it("returns false when already completed", () => {
			const settings = makeSettings();
			settings.markOnboardingCompleted("0.65.0");
			const io: WizardIO = {
				stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
				stdout: process.stdout,
				stderr: process.stderr,
			};
			expect(shouldRunOnboarding(settings, io)).toBe(false);
		});

		it("returns false when stdin is not a TTY", () => {
			const settings = makeSettings();
			const io: WizardIO = {
				stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
				stdout: process.stdout,
				stderr: process.stderr,
			};
			expect(shouldRunOnboarding(settings, io)).toBe(false);
		});

		it("returns false when CAVE_SKIP_ONBOARDING=1", () => {
			const settings = makeSettings();
			const io: WizardIO = {
				stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
				stdout: process.stdout,
				stderr: process.stderr,
			};
			const prev = process.env.CAVE_SKIP_ONBOARDING;
			process.env.CAVE_SKIP_ONBOARDING = "1";
			try {
				expect(shouldRunOnboarding(settings, io)).toBe(false);
			} finally {
				if (prev === undefined) delete process.env.CAVE_SKIP_ONBOARDING;
				else process.env.CAVE_SKIP_ONBOARDING = prev;
			}
		});
	});

	describe("persistAnswers", () => {
		it("stores theme, provider/model, telemetry, and onboarding flag", async () => {
			const settings = makeSettings();
			const answers: WizardAnswers = {
				theme: "dark",
				auth: { type: "use-env", provider: "anthropic" },
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-5",
				telemetry: false,
			};
			persistAnswers(settings, answers);
			await settings.flush();
			const fresh = SettingsManager.create(projectDir, agentDir);
			expect(fresh.getHasCompletedOnboarding()).toBe(true);
			expect(fresh.getTelemetryEnabled()).toBe(false);
			expect(fresh.getDefaultProvider()).toBe("anthropic");
			expect(fresh.getDefaultModel()).toBe("claude-sonnet-4-5");
			expect(fresh.getTheme()).toBe("default-dark");
		});

		it("respects 'auto' theme by leaving theme unset", async () => {
			const settings = makeSettings();
			persistAnswers(settings, {
				theme: "auto",
				auth: { type: "skip" },
				telemetry: false,
			});
			await settings.flush();
			const fresh = SettingsManager.create(projectDir, agentDir);
			expect(fresh.getTheme()).toBeUndefined();
			expect(fresh.getHasCompletedOnboarding()).toBe(true);
		});

		it("telemetry default is OFF after onboarding (WS11 mandate)", () => {
			const settings = makeSettings();
			persistAnswers(settings, { theme: "auto", auth: { type: "skip" }, telemetry: false });
			expect(settings.getTelemetryEnabled()).toBe(false);
		});
	});

	describe("runOnboarding", () => {
		it("completes the default no-env path and consumes the final Enter", async () => {
			const settings = makeSettings();
			// No-env path: theme, auth launch-login, telemetry, final continue prompt. Empty -> defaults.
			const io = makeIO(["", "", "", ""], {});
			const result = await runOnboarding(settings, io);
			expect(result.theme).toBe("auto");
			expect(result.auth).toEqual({ type: "launch-login" });
			expect(result.telemetry).toBe(false);
			expect(io.remaining()).toEqual([]);
			expect(settings.getHasCompletedOnboarding()).toBe(true);
		});

		it("uses detected env keys when present", async () => {
			const settings = makeSettings();
			// 4-question path (env key present): theme=default, auth=1, default model=1, telemetry=default
			const io = makeIO(["", "1", "1", "", ""], { anthropic: "sk-ant-test" });
			const result = await runOnboarding(settings, io);
			expect(result.auth.type).toBe("use-env");
			expect(result.defaultProvider).toBe("anthropic");
			expect(result.defaultModel).toBe("claude-sonnet-4-5");
			expect(settings.getDefaultProvider()).toBe("anthropic");
		});

		it("re-prompts on invalid answer", async () => {
			const settings = makeSettings();
			// theme: invalid 'q' first, then '2' (dark)
			const io = makeIO(["q", "2", "", "", ""]);
			const result = await runOnboarding(settings, io);
			expect(result.theme).toBe("dark");
		});
	});
});
