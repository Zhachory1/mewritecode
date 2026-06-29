import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";
import { detectAvailableEnvProviders, runOnboarding, type WizardIO } from "../src/onboarding/wizard.js";

describe("WS11 onboarding wizard — auth gate (F3)", () => {
	const testDir = join(process.cwd(), "test-onboarding-gate-tmp");
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

	function makeIO(answers: string[], over: Partial<WizardIO> = {}): WizardIO {
		const queue = [...answers];
		return {
			stdin: new PassThrough(),
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			envProbe: () => undefined,
			prompt: async () => queue.shift() ?? "",
			...over,
		} as WizardIO;
	}

	it("no env key + 'y' to 'Configure auth now?' returns launch-login", async () => {
		// answers: theme(default ""), auth-gate "y", telemetry "N", final continue
		const answers = await runOnboarding(makeSettings(), makeIO(["", "y", "", ""]));
		expect(answers.auth).toEqual({ type: "launch-login" });
	});

	it("no env key + 'n' to 'Configure auth now?' returns skip", async () => {
		const answers = await runOnboarding(makeSettings(), makeIO(["", "n", "", ""]));
		expect(answers.auth).toEqual({ type: "skip" });
	});

	it("detectAvailableEnvProviders reports a stored-OAuth provider as configured", () => {
		const found = detectAvailableEnvProviders({
			stdin: process.stdin,
			stdout: process.stdout,
			stderr: process.stderr,
			envProbe: () => undefined,
			oauthProbe: () => ["anthropic"],
		});
		expect(found.map((f) => f.id)).toContain("anthropic");
	});

	it("does not duplicate a provider present in both env and stored OAuth", () => {
		const found = detectAvailableEnvProviders({
			stdin: process.stdin,
			stdout: process.stdout,
			stderr: process.stderr,
			envProbe: (p) => (p === "anthropic" ? "sk-ant" : undefined),
			oauthProbe: () => ["anthropic"],
		});
		expect(found.filter((f) => f.id === "anthropic")).toHaveLength(1);
	});
});
