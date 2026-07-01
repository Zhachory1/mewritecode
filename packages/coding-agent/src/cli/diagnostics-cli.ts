import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import chalk from "chalk";
import { APP_NAME, getAgentDir, VERSION } from "../config.js";
import { SettingsManager } from "../core/settings-manager.js";
import { exportDiagnostics } from "../diagnostics/export.js";
import { createDiagnosticsRecorder } from "../diagnostics/recorder.js";
import { DIAGNOSTICS_RETENTION_BYTES, DIAGNOSTICS_RETENTION_DAYS, getDiagnosticsPaths } from "../diagnostics/store.js";

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
  ${APP_NAME} diagnostics export [--since 7d] [--until 2026-07-01]
  ${APP_NAME} diagnostics disable
  ${APP_NAME} diagnostics enable`);
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
