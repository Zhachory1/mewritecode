import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";
import type { CommandAttributes } from "../src/diagnostics/events.js";
import { exportDiagnostics } from "../src/diagnostics/export.js";
import { createDiagnosticsRecorder } from "../src/diagnostics/recorder.js";
import { getDiagnosticsPaths } from "../src/diagnostics/store.js";

function parseTarGz(path: string): Map<string, string> {
	const buffer = gunzipSync(readFileSync(path));
	const entries = new Map<string, string>();
	let offset = 0;
	while (offset + 512 <= buffer.length) {
		const name = buffer.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
		if (!name) break;
		const sizeText = buffer
			.toString("ascii", offset + 124, offset + 136)
			.replace(/\0.*$/, "")
			.trim();
		const size = Number.parseInt(sizeText || "0", 8);
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		entries.set(name, buffer.toString("utf8", dataStart, dataEnd));
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

describe("offline diagnostics", () => {
	const testDir = join(process.cwd(), "test-diagnostics-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	function settings() {
		return SettingsManager.create(projectDir, agentDir);
	}

	it("defaults diagnostics on and persists opt-out", async () => {
		const manager = settings();
		expect(manager.getDiagnosticsEnabled()).toBe(true);
		manager.setDiagnosticsEnabled(false);
		await manager.flush();
		expect(SettingsManager.create(projectDir, agentDir).getDiagnosticsEnabled()).toBe(false);
	});

	it("writes allowlisted events and drops sensitive fields before persistence", () => {
		const manager = settings();
		const recorder = createDiagnosticsRecorder({ agentDir, settingsManager: manager, sessionId: "session-1" });
		const attrs = {
			commandName: "diagnostics.status",
			commandKind: "cli",
			success: true,
			apiKey: "sk-secret-value-1234567890",
		} as unknown as CommandAttributes;
		recorder.commandCompleted(attrs, 12);
		const file = join(getDiagnosticsPaths(agentDir).currentDir, "commands.jsonl");
		const event = JSON.parse(readFileSync(file, "utf-8")) as { attributes: Record<string, unknown> };
		expect(event.attributes.commandName).toBe("diagnostics.status");
		expect(event.attributes.apiKey).toBeUndefined();
	});

	it("records turn-end reasons to turns.jsonl", () => {
		const manager = settings();
		const recorder = createDiagnosticsRecorder({ agentDir, settingsManager: manager, sessionId: "session-1" });
		recorder.turnEnded(
			{
				turnIndex: 0,
				turnReason: "tool_batch_await",
				stopReason: "toolUse",
				toolCallCount: 2,
				hadToolResults: true,
			},
			42,
		);
		recorder.turnEnded(
			{ turnIndex: 1, turnReason: "end_turn", stopReason: "stop", toolCallCount: 0, hadToolResults: false },
			7,
		);
		const file = join(getDiagnosticsPaths(agentDir).currentDir, "turns.jsonl");
		const lines = readFileSync(file, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0]) as { type: string; attributes: Record<string, unknown> };
		expect(first.type).toBe("turn.ended");
		expect(first.attributes.turnReason).toBe("tool_batch_await");
		expect(first.attributes.toolCallCount).toBe(2);
		const second = JSON.parse(lines[1]) as { attributes: Record<string, unknown> };
		expect(second.attributes.turnReason).toBe("end_turn");
	});

	it("drops turn records when diagnostics are disabled", async () => {
		const manager = settings();
		manager.setDiagnosticsEnabled(false);
		await manager.flush();
		const recorder = createDiagnosticsRecorder({ agentDir, settingsManager: manager, sessionId: "session-1" });
		recorder.turnEnded(
			{ turnIndex: 0, turnReason: "end_turn", stopReason: "stop", toolCallCount: 0, hadToolResults: false },
			1,
		);
		expect(existsSync(join(getDiagnosticsPaths(agentDir).currentDir, "turns.jsonl"))).toBe(false);
	});

	it("exports a reviewable tarball without optional sensitive sections", async () => {
		const manager = settings();
		const recorder = createDiagnosticsRecorder({ agentDir, settingsManager: manager, sessionId: "session-1" });
		recorder.sessionStarted({ appVersion: "1.0.0", packageEntryPoint: "test" });
		recorder.toolCallCompleted(
			{ toolName: "read", toolCategory: "filesystem", success: true, argsCaptured: false },
			5,
		);
		recorder.modelRequestCompleted(
			{
				provider: "anthropic",
				model: "claude-sonnet",
				inputTokens: 10,
				outputTokens: 2,
				retryCount: 0,
			},
			100,
		);

		const result = await exportDiagnostics({
			agentDir,
			settingsManager: manager,
			now: new Date("2026-07-01T00:00:00Z"),
		});
		const entries = parseTarGz(result.path);
		const names = [...entries.keys()];
		expect(names.some((name) => name.endsWith("/manifest.json"))).toBe(true);
		expect(names.some((name) => name.endsWith("/README.md"))).toBe(true);
		expect(names.some((name) => name.includes("/optional/"))).toBe(false);
		const manifestEntry = names.find((name) => name.endsWith("/manifest.json"));
		expect(manifestEntry).toBeDefined();
		const manifest = JSON.parse(entries.get(manifestEntry!) ?? "{}") as {
			optionalIncludes?: unknown[];
			complete?: boolean;
		};
		expect(manifest.optionalIncludes).toEqual([]);
		expect(manifest.complete).toBe(true);
	});
});
