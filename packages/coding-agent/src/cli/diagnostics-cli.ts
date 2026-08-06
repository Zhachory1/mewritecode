import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import chalk from "chalk";
import { APP_NAME, getAgentDir, VERSION } from "../config.js";
import { SettingsManager } from "../core/settings-manager.js";
import { exportDiagnostics } from "../diagnostics/export.js";
import { createDiagnosticsRecorder } from "../diagnostics/recorder.js";
import {
	DIAGNOSTICS_RETENTION_BYTES,
	DIAGNOSTICS_RETENTION_DAYS,
	getDiagnosticsPaths,
	readDiagnosticsInputs,
} from "../diagnostics/store.js";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseFlagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	return args[index + 1];
}

function printUsage(): void {
	console.log(`${chalk.bold(`${APP_NAME} diagnostics`)}

Commands:
  ${APP_NAME} diagnostics status
  ${APP_NAME} diagnostics turns [--limit 20]
  ${APP_NAME} diagnostics export [--since 7d] [--until 2026-07-01]
  ${APP_NAME} diagnostics disable
  ${APP_NAME} diagnostics enable`);
}

interface TurnRecord {
	timestamp: string;
	sessionId: string;
	durationMs?: number;
	turnIndex?: number;
	turnReason?: string;
	stopReason?: string;
	toolCallCount?: number;
}

function readRecentTurns(agentDir: string, limit: number): TurnRecord[] {
	const turns: TurnRecord[] = [];
	for (const file of readDiagnosticsInputs(agentDir)) {
		if (file.name !== "turns.jsonl") continue;
		for (const line of file.content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as {
					timestamp?: string;
					sessionId?: string;
					durationMs?: number;
					attributes?: Record<string, unknown>;
				};
				if (!event.timestamp) continue;
				turns.push({
					timestamp: event.timestamp,
					sessionId: event.sessionId ?? "unknown",
					durationMs: event.durationMs,
					turnIndex: event.attributes?.turnIndex as number | undefined,
					turnReason: event.attributes?.turnReason as string | undefined,
					stopReason: event.attributes?.stopReason as string | undefined,
					toolCallCount: event.attributes?.toolCallCount as number | undefined,
				});
			} catch {
				// skip malformed line
			}
		}
	}
	turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	return turns.slice(-limit);
}

function printTurns(agentDir: string, limit: number): void {
	const turns = readRecentTurns(agentDir, limit);
	if (turns.length === 0) {
		console.log("No turn-end records found. Diagnostics may be disabled, or no turns have run yet.");
		return;
	}
	console.log(chalk.bold(`Last ${turns.length} turn-end reasons (oldest first):`));
	for (const turn of turns) {
		const reason = turn.turnReason ?? "unknown";
		const tools = turn.toolCallCount !== undefined ? `${turn.toolCallCount} tool call(s)` : "";
		const duration = turn.durationMs !== undefined ? `${turn.durationMs}ms` : "";
		const detail = [tools, duration].filter(Boolean).join(", ");
		console.log(
			`  ${chalk.dim(turn.timestamp)}  ${chalk.cyan(reason.padEnd(16))}${detail ? chalk.dim(` — ${detail}`) : ""}`,
		);
	}
}

function printStatus(settingsManager: SettingsManager, agentDir: string): void {
	const paths = getDiagnosticsPaths(agentDir);
	const settings = settingsManager.getDiagnosticsSettings();
	console.log(`Diagnostics: ${settings.enabled ? "enabled" : "disabled"}`);
	console.log(`Notice shown: ${settings.noticeShown ? "yes" : "no"}`);
	console.log(`Storage: ${paths.rootDir}`);
	console.log(`Retention: ${DIAGNOSTICS_RETENTION_DAYS} days / ${formatBytes(DIAGNOSTICS_RETENTION_BYTES)}`);
	console.log(`Last export: ${settings.lastExportPath ?? "never"}`);
	console.log(
		"Never included in V1: prompts, responses, transcripts, file contents, tool args, shell command text, env values, API keys, config files, log tails, workspace files",
	);
}

export async function handleDiagnosticsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "diagnostics") return false;
	const subcommand = args[1] ?? "status";
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(process.cwd(), agentDir);
	const recorder = createDiagnosticsRecorder({ agentDir, settingsManager, sessionId: randomUUID() });
	const startedAt = Date.now();
	try {
		recorder.sessionStarted({ appVersion: VERSION, packageEntryPoint: "diagnostics" });
		if (subcommand === "status") {
			printStatus(settingsManager, agentDir);
			recorder.commandCompleted(
				{ commandName: "diagnostics.status", commandKind: "cli", success: true },
				Date.now() - startedAt,
			);
			await settingsManager.flush();
			return true;
		}
		if (subcommand === "turns") {
			const limitRaw = parseFlagValue(args, "--limit");
			const limit = limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10) || 20) : 20;
			printTurns(agentDir, limit);
			recorder.commandCompleted(
				{ commandName: "diagnostics.turns", commandKind: "cli", success: true },
				Date.now() - startedAt,
			);
			await settingsManager.flush();
			return true;
		}
		if (subcommand === "enable") {
			settingsManager.setDiagnosticsEnabled(true);
			recorder.commandCompleted(
				{ commandName: "diagnostics.enable", commandKind: "cli", success: true },
				Date.now() - startedAt,
			);
			await settingsManager.flush();
			console.log("Diagnostics enabled. Captured records stay local unless you export and share them.");
			return true;
		}
		if (subcommand === "disable") {
			settingsManager.setDiagnosticsEnabled(false);
			recorder.commandCompleted(
				{ commandName: "diagnostics.disable", commandKind: "cli", success: true },
				Date.now() - startedAt,
			);
			await settingsManager.flush();
			console.log("Diagnostics disabled.");
			return true;
		}
		if (subcommand === "export") {
			const result = await exportDiagnostics({
				agentDir,
				settingsManager,
				since: parseFlagValue(args, "--since"),
				until: parseFlagValue(args, "--until"),
			});
			recorder.commandCompleted(
				{ commandName: "diagnostics.export", commandKind: "cli", success: true },
				Date.now() - startedAt,
			);
			await settingsManager.flush();
			const size = formatBytes(statSync(result.path).size);
			console.log(`Exported diagnostics bundle: ${result.path}`);
			console.log(`Size: ${size}`);
			console.log(`Date range: ${result.dateRange.since} to ${result.dateRange.until}`);
			console.log(`Included files: ${result.includedFiles.join(", ")}`);
			console.log("Review the bundle before sharing. No upload was performed.");
			return true;
		}
		printUsage();
		recorder.commandCompleted(
			{ commandName: `diagnostics.${subcommand}`, commandKind: "cli", success: false },
			Date.now() - startedAt,
		);
		await settingsManager.flush();
		return true;
	} catch (error) {
		recorder.commandCompleted(
			{ commandName: `diagnostics.${subcommand}`, commandKind: "cli", success: false },
			Date.now() - startedAt,
		);
		await settingsManager.flush();
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}
