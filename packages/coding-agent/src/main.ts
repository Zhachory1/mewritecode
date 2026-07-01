/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { type ImageContent, modelsAreEqual, supportsXhigh } from "@zhachory1/mewrite-ai";
import { detectTerminalIdentity, ProcessTerminal, probeTerminal, setKeybindings, TUI } from "@zhachory1/mewrite-tui";
import chalk from "chalk";
import { type Args, type Mode, parseArgs, printHelp } from "./cli/args.js";
import { handleAttachCommand } from "./cli/attach.js";
import { handleDiagnosticsCommand } from "./cli/diagnostics-cli.js";
import { runDoctor } from "./cli/doctor.js";
import { handleExecCommand } from "./cli/exec.js";
import { processFileArguments } from "./cli/file-processor.js";
import { handleGoalCommand } from "./cli/goal-cli.js";
import { buildInitialMessage } from "./cli/initial-message.js";
import { handleListCommand } from "./cli/list.js";
import { listModels } from "./cli/list-models.js";
import { runLogin } from "./cli/login.js";
import { handleMcpCommand } from "./cli/mcp-cli.js";
import { handleMigrateCommand } from "./cli/migrate-cli.js";
import { handleModelsCommand } from "./cli/models.js";
import { handlePluginCommand } from "./cli/plugin.js";
import { handleRollbackCommand } from "./cli/rollback.js";
import { handleRunRecipeCommand } from "./cli/run-recipe.js";
import { handleServeCommand } from "./cli/serve.js";
import { selectSession } from "./cli/session-picker.js";
import { handleSubagentsCommand } from "./cli/subagents-cli.js";
import { runSelfUpdate } from "./cli/update.js";
import { handleWatchCommand } from "./cli/watch.js";
import { handleWorkerCommand } from "./cli/worker.js";
import {
	APP_NAME,
	DISTRIBUTION_APPEND_SYSTEM_PROMPT,
	DISTRIBUTION_SYSTEM_PROMPT_BRANDING,
	getAgentDir,
	getModelsPath,
	VERSION,
} from "./config.js";
import { type CreateAgentSessionRuntimeFactory, createAgentSessionRuntime } from "./core/agent-session-runtime.js";
import {
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./core/agent-session-services.js";
import { AuthStorage } from "./core/auth-storage.js";
import { exportFromFile } from "./core/export-html/index.js";
import { KeybindingsManager } from "./core/keybindings.js";
import type { ModelRegistry } from "./core/model-registry.js";
import { resolveCliModel, resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { restoreStdout, takeOverStdout } from "./core/output-guard.js";
import type { CreateAgentSessionOptions } from "./core/sdk.js";
import {
	formatMissingSessionCwdPrompt,
	getMissingSessionCwdIssue,
	MissingSessionCwdError,
	type SessionCwdIssue,
} from "./core/session-cwd.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { printTimings, resetTimings, time } from "./core/timings.js";
import { allTools } from "./core/tools/index.js";
import { createDiagnosticsRecorder } from "./diagnostics/recorder.js";
import { attachDiagnosticsSessionListener } from "./diagnostics/session-listener.js";
import { runMigrations, showDeprecationWarnings } from "./migrations.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { ExtensionSelectorComponent } from "./modes/interactive/components/extension-selector.js";
import {
	initTheme,
	setDetectedBackground,
	setRegisteredThemes,
	stopThemeWatcher,
} from "./modes/interactive/theme/theme.js";
import { DEFAULT_IO, runOnboarding, shouldRunOnboarding } from "./onboarding/wizard.js";
import { handleConfigCommand, handlePackageCommand } from "./package-manager-cli.js";
import { isLocalPath } from "./utils/paths.js";

/**
 * Read all content from piped stdin.
 * Returns undefined if stdin is a TTY (interactive terminal).
 */
async function readPipedStdin(): Promise<string | undefined> {
	// If stdin is a TTY, we're running interactively - don't read stdin
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}

function collectSettingsDiagnostics(
	settingsManager: SettingsManager,
	context: string,
): AgentSessionRuntimeDiagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${context}, ${scope} settings) ${error.message}`,
	}));
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
		const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

type AppMode = "interactive" | "print" | "json" | "rpc";

function resolveAppMode(parsed: Args, stdinIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") {
		return "rpc";
	}
	if (parsed.mode === "json") {
		return "json";
	}
	if (parsed.print || !stdinIsTTY) {
		return "print";
	}
	return "interactive";
}

function shouldAutoDetectTheme(settingsManager: SettingsManager): boolean {
	const configuredTheme = settingsManager.getTheme();
	return configuredTheme === undefined || configuredTheme === "auto";
}

async function primeAutoThemeDetection(settingsManager: SettingsManager): Promise<void> {
	if (!shouldAutoDetectTheme(settingsManager)) return;
	try {
		const probe = await probeTerminal({ timeoutMs: 150 });
		setDetectedBackground(probe.classification);
	} catch {
		// Probe is best-effort; theme.ts falls back to COLORFGBG/CAVE_TERM_BG/dark.
	}
}

function normalizeDistributionAppendSystemPrompt(): string | undefined {
	const value = DISTRIBUTION_APPEND_SYSTEM_PROMPT?.trim();
	return value && value.length > 0 ? value : undefined;
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images,
		stdinContent,
	});
}

/** Result from resolving a session argument */
type ResolvedSession =
	| { type: "path"; path: string } // Direct file path
	| { type: "local"; path: string } // Found in current project
	| { type: "global"; path: string; cwd: string } // Found in different project
	| { type: "not_found"; arg: string }; // Not found anywhere

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, use as-is. Otherwise try to match as session ID prefix.
 */
async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<ResolvedSession> {
	// If it looks like a file path, use as-is
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: sessionArg };
	}

	// Try to match as session ID in current project first
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatches = localSessions.filter((s) => s.id.startsWith(sessionArg));

	if (localMatches.length >= 1) {
		return { type: "local", path: localMatches[0].path };
	}

	// Try global search across all projects
	const allSessions = await SessionManager.listAll();
	const globalMatches = allSessions.filter((s) => s.id.startsWith(sessionArg));

	if (globalMatches.length >= 1) {
		const match = globalMatches[0];
		return { type: "global", path: match.path, cwd: match.cwd };
	}

	// Not found anywhere
	return { type: "not_found", arg: sessionArg };
}

/** Prompt user for yes/no confirmation */
async function promptConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

function validateForkFlags(parsed: Args): void {
	if (!parsed.fork) return;

	const conflictingFlags = [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
		parsed.noSession ? "--no-session" : undefined,
	].filter((flag): flag is string => flag !== undefined);

	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}
}

function forkSessionOrExit(sourcePath: string, cwd: string, sessionDir?: string): SessionManager {
	try {
		return SessionManager.forkFrom(sourcePath, cwd, sessionDir);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}

	if (parsed.fork) {
		const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
			case "global":
				return forkSessionOrExit(resolved.path, cwd, sessionDir);

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
				return SessionManager.open(resolved.path, sessionDir);

			case "global": {
				console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
				const shouldFork = await promptConfirm("Fork this session into current directory?");
				if (!shouldFork) {
					console.log(chalk.dim("Aborted."));
					process.exit(0);
				}
				return forkSessionOrExit(resolved.path, cwd, sessionDir);
			}

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.resume) {
		await primeAutoThemeDetection(settingsManager);
		initTheme(settingsManager.getTheme(), true);
		try {
			const selectedPath = await selectSession(
				(onProgress) => SessionManager.list(cwd, sessionDir, onProgress),
				SessionManager.listAll,
			);
			if (!selectedPath) {
				console.log(chalk.dim("No session selected"));
				process.exit(0);
			}
			return SessionManager.open(selectedPath, sessionDir);
		} finally {
			stopThemeWatcher();
		}
	}

	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	return SessionManager.create(cwd, sessionDir);
}

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	hasExistingSession: boolean,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
): {
	options: CreateAgentSessionOptions;
	cliThinkingFromModel: boolean;
	diagnostics: AgentSessionRuntimeDiagnostic[];
} {
	const options: CreateAgentSessionOptions = {};
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	let cliThinkingFromModel = false;

	// Model from CLI
	// - supports --provider <name> --model <pattern>
	// - supports --model <provider>/<pattern>
	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			modelRegistry,
		});
		if (resolved.warning) {
			diagnostics.push({ type: "warning", message: resolved.warning });
		}
		if (resolved.error) {
			diagnostics.push({ type: "error", message: resolved.error });
		}
		if (resolved.model) {
			options.model = resolved.model;
			// Allow "--model <pattern>:<thinking>" as a shorthand.
			// Explicit --thinking still takes precedence (applied later).
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
		// Check if saved default is in scoped models - use it if so, otherwise first scoped model
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

		if (savedInScope) {
			options.model = savedInScope.model;
			// Use thinking level from scoped model config if explicitly set
			if (!parsed.thinking && savedInScope.thinkingLevel) {
				options.thinkingLevel = savedInScope.thinkingLevel;
			}
		} else {
			options.model = scopedModels[0].model;
			// Use thinking level from first scoped model if explicitly set
			if (!parsed.thinking && scopedModels[0].thinkingLevel) {
				options.thinkingLevel = scopedModels[0].thinkingLevel;
			}
		}
	}

	// Thinking level from CLI (takes precedence over scoped model thinking levels set above)
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	}

	// Scoped models for Ctrl+P cycling
	// Keep thinking level undefined when not explicitly set in the model pattern.
	// Undefined means "inherit current session thinking level" during cycling.
	if (scopedModels.length > 0) {
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel,
		}));
	}

	// API key from CLI - set in authStorage
	// (handled by caller before createAgentSession)

	// Tools
	if (parsed.noTools) {
		// --no-tools: start with no built-in tools
		// --tools can still add specific ones back
		if (parsed.tools && parsed.tools.length > 0) {
			options.tools = parsed.tools.map((name) => allTools[name]);
		} else {
			options.tools = [];
		}
	} else if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	if (parsed.maxTurns && parsed.maxTurns > 0) {
		options.maxTurns = parsed.maxTurns;
	}

	return { options, cliThinkingFromModel, diagnostics };
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
	return paths?.map((value) => (isLocalPath(value) ? resolve(cwd, value) : value));
}

async function promptForMissingSessionCwd(
	issue: SessionCwdIssue,
	settingsManager: SettingsManager,
): Promise<string | undefined> {
	await primeAutoThemeDetection(settingsManager);
	initTheme(settingsManager.getTheme());
	setKeybindings(KeybindingsManager.create());

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal(), settingsManager.getShowHardwareCursor());
		ui.setClearOnShrink(settingsManager.getClearOnShrink());

		let settled = false;
		const finish = (result: string | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			ui.stop();
			resolve(result);
		};

		const selector = new ExtensionSelectorComponent(
			formatMissingSessionCwdPrompt(issue),
			["Continue", "Cancel"],
			(option) => finish(option === "Continue" ? issue.fallbackCwd : undefined),
			() => finish(undefined),
			{ tui: ui },
		);
		ui.addChild(selector);
		ui.setFocus(selector);
		ui.start();
	});
}

/**
 * Best-effort process.on("exit") safety net: if we die while the TUI is in
 * alt-screen mode with mouse tracking on, this restores the terminal so the
 * user's shell isn't unusable afterward. Idempotent — the TUI's own teardown
 * runs first in all normal paths.
 */
function installExitSafetyNet(): void {
	process.on("exit", () => {
		if (!process.stdout.isTTY) return;
		try {
			// Disable mouse, leave alt screen, show cursor, reset SGR.
			process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?1049l\x1b[?25h\x1b[0m");
		} catch {
			// Can't do anything if stdout is gone.
		}
	});
}

/**
 * Emit a single-line JSON diagnostic to stderr before the UI boots, when
 * CAVE_DEBUG_TERM=1. Used to verify terminal detection under different hosts
 * (ghostty, iTerm, tmux, ssh, etc.) without starting the full UI.
 * Must not block boot more than 200ms per cavekit-terminal-blend R2.
 */
async function emitDebugTermDiagnostic(): Promise<void> {
	if (process.env.CAVE_DEBUG_TERM !== "1") return;
	const identity = detectTerminalIdentity();
	let bgPayload: Record<string, unknown> = {};
	try {
		const probe = await probeTerminal({ timeoutMs: 150 });
		if (probe.background) {
			const bg = probe.background;
			bgPayload = {
				bg: `#${bg.r.toString(16).padStart(2, "0")}${bg.g.toString(16).padStart(2, "0")}${bg.b.toString(16).padStart(2, "0")}`,
				isDark: bg.classification === "dark",
				bgSource: bg.source,
			};
		} else {
			bgPayload = { classification: probe.classification };
		}
	} catch {
		// No-op — diagnostic is best-effort.
	}
	const line = JSON.stringify({
		program: identity.program,
		hostProgram: identity.hostProgram,
		version: identity.version,
		multiplexer: identity.multiplexer,
		isSsh: identity.isSsh,
		...bgPayload,
	});
	process.stderr.write(`[cave-term] ${line}\n`);
}

export async function main(args: string[]) {
	resetTimings();
	installExitSafetyNet();
	await emitDebugTermDiagnostic();
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (offlineMode) {
		process.env.PI_OFFLINE = "1";
		process.env.PI_SKIP_VERSION_CHECK = "1";
	}

	// WS11: lightweight subcommands that don't need a session.
	// `doctor`, `self-update`, and `login` are read-only or auth-only commands
	// that should boot fast (≤200ms) and never load the agent runtime.
	if (args[0] === "doctor") {
		const code = await runDoctor(args.slice(1));
		process.exit(code);
	}
	if (args[0] === "self-update" || args[0] === "selfupdate") {
		const code = await runSelfUpdate(args.slice(1));
		process.exit(code);
	}
	if (args[0] === "login") {
		const code = await runLogin(args.slice(1));
		process.exit(code);
	}
	if (await handleDiagnosticsCommand(args)) {
		return;
	}

	if (await handlePackageCommand(args)) {
		return;
	}

	if (await handleConfigCommand(args)) {
		return;
	}

	// #15: `caveman migrate --from claude` — one-step Claude Code config reuse.
	if (await handleMigrateCommand(args)) {
		return;
	}

	// #59 stage 3: `caveman subagents {list,install --from claude,install --to claude}` —
	// explicit bidirectional install for the bundled subagent extension's agents.
	if (await handleSubagentsCommand(args)) {
		return;
	}

	// WS2: `caveman mcp <subcmd>` and `caveman mcp-server`
	if (await handleMcpCommand(args)) {
		return;
	}

	// WS9: daemon + multi-client attach.
	//   caveman serve [--port N]      — boot the daemon
	//   caveman sessions (alias `ps`) — list daemon sessions (`cave list` is
	//                                already used by the extensions package
	//                                manager; `sessions` is the WS9 canonical)
	//   caveman attach <id>           — attach to a session over WS
	//   cave worker {register,...} — manage remote-worker registry for &-prefix handoff
	if (await handleServeCommand(args)) {
		return;
	}
	if (await handleListCommand(args)) {
		return;
	}
	if (await handleAttachCommand(args)) {
		return;
	}
	if (await handleWorkerCommand(args)) {
		return;
	}

	// WS18: watch — file watcher for configured comment triggers.
	if (await handleWatchCommand(args)) {
		return;
	}

	// WS16: cave exec — non-interactive single-shot CI mode.
	if (await handleExecCommand(args)) {
		return;
	}

	// `caveman goal …` — autonomous Ralph-style goal loop driver.
	if (await handleGoalCommand(args)) {
		return;
	}

	// WS13: cave plugin — plugin marketplace (search, install, list, upgrade, marketplace).
	if (await handlePluginCommand(args)) {
		return;
	}

	// WS14: caveman run-recipe — Goose-style YAML recipe runner.
	if (await handleRunRecipeCommand(args)) {
		return;
	}

	// WS17: cave rollback — shadow-git checkpoint rollback.
	if (await handleRollbackCommand(args)) {
		return;
	}

	// WS15: caveman models — provider/model registry (update, list, inspect).
	const modelsExitCode = await handleModelsCommand(args);
	if (modelsExitCode !== -1) {
		process.exit(modelsExitCode);
	}

	const parsed = parseArgs(args);
	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			process.exit(1);
		}
	}
	time("parseArgs");
	// #14: --approval sets the env flag early so SettingsManager (and any spawned
	// subagent, which inherits env) picks up OPT-IN approval mode. Human-review
	// speed-bump, NOT a security perimeter.
	if (parsed.approval) {
		process.env.CAVE_APPROVAL_MODE = "1";
	}
	let appMode = resolveAppMode(parsed, process.stdin.isTTY);
	// LOW-5: --approval needs an interactive TTY to show the approval dialog. In
	// headless/print/json/rpc mode there is no approval channel, so the gate
	// denies-by-default → every write/exec call fails. Warn loudly instead of
	// failing opaquely in CI. (Don't refuse to start; just warn.)
	if (parsed.approval && appMode !== "interactive") {
		process.stderr.write(
			"warning: --approval has no effect in non-interactive mode — all write/exec calls will be denied\n",
		);
	}
	const shouldTakeOverStdout = appMode !== "interactive";
	if (shouldTakeOverStdout) {
		takeOverStdout();
	}

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	validateForkFlags(parsed);

	// Run migrations (pass cwd for project-local migrations)
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(process.cwd());
	time("runMigrations");

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, "startup session lookup"));

	// WS11: First-run wizard — only in interactive mode, only when stdin is a TTY,
	// only when the user hasn't completed it before. Bounded to ≤5s on the happy
	// path because we ask at most 4 questions and never load any heavy modules.
	let launchLoginOnStart = false;
	if (appMode === "interactive" && shouldRunOnboarding(startupSettingsManager)) {
		try {
			// Surface stored OAuth credentials to the wizard so an already-authed
			// user isn't re-prompted (F3). Keep the wizard dependency-light by
			// injecting the probe rather than importing AuthStorage there.
			const onboardingAuth = AuthStorage.create();
			const answers = await runOnboarding(startupSettingsManager, {
				...DEFAULT_IO,
				oauthProbe: () => onboardingAuth.list().filter((p) => onboardingAuth.get(p)?.type === "oauth"),
			});
			// F3 hand-off: if the user chose "configure auth now", open the login
			// selector on interactive start instead of the F1 auto-gate (M4).
			launchLoginOnStart = answers.auth.type === "launch-login";
		} catch (err) {
			// Don't block startup if the wizard fails — log and continue.
			const msg = err instanceof Error ? err.message : String(err);
			console.error(chalk.yellow(`Warning: onboarding wizard failed: ${msg}`));
		}
	}

	// WS11: Update check is handled by interactive-mode (renders a styled
	// callout via maybeNotifyUpdateAvailable). For non-interactive runs we
	// skip the notification so it doesn't pollute scripted output.

	// Decide the final runtime cwd before creating cwd-bound runtime services.
	// --session and --resume may select a session from another project, so project-local
	// settings, resources, provider registrations, and models must be resolved only after
	// the target session cwd is known. The startup-cwd settings manager is used only for
	// sessionDir lookup during session selection.
	const sessionDir = parsed.sessionDir ?? startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	if (missingSessionCwdIssue) {
		if (appMode === "interactive") {
			const selectedCwd = await promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager);
			if (!selectedCwd) {
				process.exit(0);
			}
			sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
		} else {
			console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
			process.exit(1);
		}
	}
	time("createSessionManager");

	const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
	const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
	const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
	const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
	const distributionAppendSystemPrompt = normalizeDistributionAppendSystemPrompt();
	const authStorage = AuthStorage.create();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		agentDir,
		sessionManager,
		sessionStartEvent,
	}) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
			},
		});
		const { settingsManager, modelRegistry, resourceLoader } = services;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager, "runtime creation"),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];

		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels =
			modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
		const {
			options: sessionOptions,
			cliThinkingFromModel,
			diagnostics: sessionOptionDiagnostics,
		} = buildSessionOptions(
			parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRegistry,
			settingsManager,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				diagnostics.push({
					type: "error",
					message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
				});
			} else {
				authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			customTools: sessionOptions.customTools,
			systemPromptBranding: DISTRIBUTION_SYSTEM_PROMPT_BRANDING,
			appendSystemPrompt: distributionAppendSystemPrompt,
		});
		const diagnosticsRecorder = createDiagnosticsRecorder({
			agentDir: services.agentDir,
			settingsManager,
			sessionId: created.session.sessionId,
		});
		diagnosticsRecorder.sessionStarted({
			appVersion: VERSION,
			packageEntryPoint: appMode,
		});
		diagnosticsRecorder.environmentReported({
			os: process.platform,
			arch: process.arch,
			nodeVersion: process.version,
			terminalColumns: process.stdout.columns,
			terminalRows: process.stdout.rows,
			shellName: basename(process.env.SHELL ?? process.env.ComSpec ?? ""),
		});
		attachDiagnosticsSessionListener(created.session, diagnosticsRecorder);
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			let effectiveThinking = created.session.thinkingLevel;
			if (!created.session.model.reasoning) {
				effectiveThinking = "off";
			} else if (effectiveThinking === "xhigh" && !supportsXhigh(created.session.model)) {
				effectiveThinking = "high";
			}
			if (effectiveThinking !== created.session.thinkingLevel) {
				created.session.setThinkingLevel(effectiveThinking);
			}
		}

		return {
			...created,
			services,
			diagnostics,
		};
	};
	time("createRuntime");
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	const { services, session, modelFallbackMessage } = runtime;
	const { settingsManager, modelRegistry, resourceLoader } = services;

	if (parsed.help) {
		const extensionFlags = resourceLoader
			.getExtensions()
			.extensions.flatMap((extension) => Array.from(extension.flags.values()));
		printHelp(extensionFlags);
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}

	// Read piped stdin content (if any) - skip for RPC mode which uses stdin for JSON-RPC
	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		stdinContent = await readPipedStdin();
		if (stdinContent !== undefined && appMode === "interactive") {
			appMode = "print";
		}
	}
	time("readPipedStdin");

	const { initialMessage, initialImages } = await prepareInitialMessage(
		parsed,
		settingsManager.getImageAutoResize(),
		stdinContent,
	);
	time("prepareInitialMessage");
	// Probe host terminal so theme auto-selects dark/light (terminal-blend R1, R3).
	// Explicit concrete themes still win; unset or "auto" themes use the probe.
	// One-shot at startup, never swaps mid-session per R3 AC4. Capped at 150ms per R1 AC5.
	if (appMode === "interactive") {
		await primeAutoThemeDetection(settingsManager);
	}
	setRegisteredThemes(resourceLoader.getThemes().themes);
	initTheme(settingsManager.getTheme(), appMode === "interactive");
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (appMode === "interactive" && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	const scopedModels = [...session.scopedModels];
	time("resolveModelScope");
	reportDiagnostics(runtime.diagnostics);
	if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
		process.exit(1);
	}
	time("createAgentSession");

	if (appMode !== "interactive" && !session.model) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow(`\nOr create ${getModelsPath()}`));
		console.error(chalk.yellow("\nOr log in with OAuth (no API key needed):"));
		console.error(`  ${APP_NAME} login            (or \`${APP_NAME} login --device-auth\` over SSH)`);
		process.exit(1);
	}

	// OQ-B: a model is selected but its auth is missing/expired (e.g. stored-but-expired
	// OAuth). Print mode would otherwise fail only at call time — surface the actionable
	// login instruction up front, mirroring F2's broadened interactive coverage.
	if (appMode !== "interactive" && session.model && !session.modelRegistry.hasConfiguredAuth(session.model)) {
		console.error(chalk.red(`No usable credentials for ${session.model.provider}.`));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow("\nOr log in with OAuth (no API key needed):"));
		console.error(
			`  ${APP_NAME} login --provider ${session.model.provider}   (or \`${APP_NAME} login --device-auth\` over SSH)`,
		);
		process.exit(1);
	}

	const startupBenchmark = isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK);
	if (startupBenchmark && appMode !== "interactive") {
		console.error(chalk.red("Error: PI_STARTUP_BENCHMARK only supports interactive mode"));
		process.exit(1);
	}

	if (appMode === "rpc") {
		printTimings();
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		if (scopedModels.length > 0 && (parsed.verbose || !settingsManager.getQuietStartup())) {
			const modelList = scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			console.log(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		const interactiveMode = new InteractiveMode(runtime, {
			migratedProviders,
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages: parsed.messages,
			verbose: parsed.verbose,
			launchLoginOnStart,
		});
		if (startupBenchmark) {
			await interactiveMode.init();
			time("interactiveMode.init");
			printTimings();
			interactiveMode.stop();
			stopThemeWatcher();
			if (process.stdout.writableLength > 0) {
				await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
			}
			if (process.stderr.writableLength > 0) {
				await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
			}
			return;
		}

		printTimings();
		await interactiveMode.run();
	} else {
		printTimings();
		const exitCode = await runPrintMode(runtime, {
			mode: toPrintOutputMode(appMode),
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		stopThemeWatcher();
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
}
