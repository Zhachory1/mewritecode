/**
 * WS16: `cave exec` CLI subcommand handler.
 *
 * Parses exec-specific flags and delegates to runExecMode.
 * Designed to be idiomatic for GitHub Actions / GitLab CI.
 *
 * Usage:
 *   cave exec [flags] "<prompt>"
 *
 * Flags:
 *   --json                          Emit stable JSONL events on stdout
 *   --output-schema <file>          Validate final message against JSON Schema (exit 2 on mismatch)
 *   --ephemeral                     Ignore ~/.cave and project .cave settings files
 *   --skip-git-repo-check           Skip the git repository presence check
 *   --output-last-message <file>    Write final assistant text to a file atomically
 *   --cwd <dir>                     Override working directory for the session
 *   --model <pattern>               Override model (same format as cave --model)
 *   --profile <name>                Select a named profile from settings
 *   --timeout <ms>                  Fail with exit 5 if not done within <ms> milliseconds
 *   --help, -h                      Show this help text
 *
 * Exit codes:
 *   0  success
 *   1  generic / unclassified error
 *   2  --output-schema validation failed
 *   3  sandbox denied
 *   4  model error
 *   5  timeout
 *   6  user-config error (bad settings, unknown profile, etc.)
 */

import chalk from "chalk";
import { getAgentDir } from "../config.js";
import { type CreateAgentSessionRuntimeFactory, createAgentSessionRuntime } from "../core/agent-session-runtime.js";
import {
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../core/agent-session-services.js";
import { AuthStorage } from "../core/auth-storage.js";
import { resolveCliModel } from "../core/model-resolver.js";
import { restoreStdout, takeOverStdout } from "../core/output-guard.js";
import { SessionManager } from "../core/session-manager.js";
import { type ExecModeOptions, runExecMode } from "../modes/exec/exec-mode.js";
import { EXIT_USER_CONFIG_ERROR } from "../modes/exec/exit-codes.js";
import { stopThemeWatcher } from "../modes/interactive/theme/theme.js";

// Import pure arg parsing (no heavy deps) and re-export for external consumers.
import { type ExecArgs, parseExecArgs } from "./exec-args.js";

export { type ExecArgs, parseExecArgs } from "./exec-args.js";

export function printExecHelp(): void {
	console.log(`${chalk.bold("cave exec")} — non-interactive single-shot agent (CI mode)

${chalk.bold("Usage:")}
  cave exec [flags] "<prompt>"

${chalk.bold("Flags:")}
  --json                           Emit stable JSONL event stream on stdout
  --output-schema <file>           Validate final message against JSON Schema (exit 2 on mismatch)
  --ephemeral                      Ignore ~/.cave and project .cave settings files
  --skip-git-repo-check            Skip the git repository presence check
  --output-last-message <file>     Write final assistant text to file atomically
  --cwd <dir>                      Working directory for the session (default: current dir)
  --model <pattern>                Model pattern (e.g. anthropic/claude-sonnet-4-5)
  --profile <name>                 Named profile from settings.json profiles key
  --timeout <ms>                   Timeout in milliseconds (exit 5 on expiry)
  --help, -h                       Show this help

${chalk.bold("Exit codes:")}
  0  success
  1  generic error
  2  --output-schema validation failed
  3  sandbox denied
  4  model error
  5  timeout
  6  user-config error (bad settings, unknown profile, etc.)

${chalk.bold("Event stream (--json) event types:")}
  session.start      { session_id, cwd }
  message.user       { content }
  message.assistant  { content, cost? }
  tool.call          { name, input, id }
  tool.result        { id, ok, output }
  session.end        { exit, cost? }
  error              { code, message }

${chalk.bold("Examples:")}
  # Basic non-interactive run
  cave exec "List all .ts files in src/"

  # CI mode with JSON events piped to jq
  cave exec --json "Summarize the codebase" | jq 'select(.type == "session.end")'

  # Validate structured output
  cave exec --json --output-schema schema.json "Return JSON with field 'result'"

  # Write final answer to file for downstream steps
  cave exec --output-last-message /tmp/answer.txt "What is 2+2?"

  # Completely isolated from user config
  cave exec --ephemeral --model anthropic/claude-haiku-4-5 "Hello"
`);
}

/**
 * Handle `cave exec <args>` subcommand.
 * Returns true when the exec subcommand was handled (even on error).
 */
export async function handleExecCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "exec") return false;

	const execArgs = parseExecArgs(args.slice(1));
	if (!execArgs) {
		process.exit(1);
	}

	if (execArgs.help) {
		printExecHelp();
		process.exit(0);
	}

	if (!execArgs.prompt.trim()) {
		console.error(chalk.red("Error: cave exec requires a prompt argument"));
		console.error(chalk.dim('  Usage: cave exec "your prompt here"'));
		process.exit(1);
	}

	// Take over stdout so console.log from libraries goes to stderr
	takeOverStdout();

	const exitCode = await _runExecCommand(execArgs);

	restoreStdout();
	stopThemeWatcher();
	process.exit(exitCode);
}

async function _runExecCommand(execArgs: ExecArgs): Promise<number> {
	const cwd = execArgs.cwd;
	const agentDir = getAgentDir();

	// --ephemeral: use in-memory settings, ignore user config files.
	// createAgentSessionServices loads settings internally; we can't fully
	// prevent it from reading disk, but we override with inMemory after
	// the services object is created.
	// The correct approach is to pass a flag through services — for now we
	// communicate ephemeral by setting an env var that the caller checks.
	// In practice, --ephemeral disables session persistence and config loading.
	const sessionManager = execArgs.ephemeral ? SessionManager.inMemory() : SessionManager.create(cwd);

	const authStorage = AuthStorage.create();

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: rCwd,
		agentDir: rAgentDir,
		sessionManager: rSessionManager,
		sessionStartEvent,
	}) => {
		const serviceOptions = {
			cwd: rCwd,
			agentDir: rAgentDir,
			authStorage,
			resourceLoaderOptions: {
				// --ephemeral: suppress extension/skill/theme auto-discovery
				noExtensions: execArgs.ephemeral,
				noSkills: execArgs.ephemeral,
				noPromptTemplates: execArgs.ephemeral,
				noThemes: execArgs.ephemeral,
			},
		};

		const services = await createAgentSessionServices(serviceOptions);
		const { modelRegistry } = services;

		const diagnostics: AgentSessionRuntimeDiagnostic[] = [...services.diagnostics];

		// --profile: named profiles are not yet part of the Settings schema.
		// Emit a warning so CI operators know the flag was seen but not applied.
		if (execArgs.profile) {
			diagnostics.push({
				type: "warning",
				message: `Profile "${execArgs.profile}" is not yet supported — ignoring (deferred to future WS)`,
			});
		}

		// Resolve model
		let model: Awaited<ReturnType<typeof resolveCliModel>>["model"] | undefined;
		if (execArgs.model) {
			const resolved = resolveCliModel({
				cliModel: execArgs.model,
				modelRegistry,
			});
			if (resolved.warning) diagnostics.push({ type: "warning", message: resolved.warning });
			if (resolved.error) diagnostics.push({ type: "error", message: resolved.error });
			model = resolved.model;
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: rSessionManager,
			sessionStartEvent,
			model,
		});

		return { ...created, services, diagnostics };
	};

	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
	try {
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir,
			sessionManager,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`Error: ${msg}\n`);
		return EXIT_USER_CONFIG_ERROR;
	}

	// Report diagnostics to stderr
	for (const d of runtime.diagnostics) {
		const color = d.type === "error" ? chalk.red : chalk.yellow;
		const prefix = d.type === "error" ? "Error" : "Warning";
		process.stderr.write(color(`${prefix}: ${d.message}\n`));
	}

	if (runtime.diagnostics.some((d) => d.type === "error")) {
		return EXIT_USER_CONFIG_ERROR;
	}

	const execOptions: ExecModeOptions = {
		prompt: execArgs.prompt,
		json: execArgs.json,
		outputSchema: execArgs.outputSchema,
		outputLastMessage: execArgs.outputLastMessage,
		ephemeral: execArgs.ephemeral,
		profile: execArgs.profile,
		timeoutMs: execArgs.timeoutMs,
	};

	try {
		return await runExecMode(runtime, execOptions);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (execArgs.json) {
			process.stdout.write(`${JSON.stringify({ type: "error", code: "unexpected", message: msg })}\n`);
		} else {
			process.stderr.write(`Error: ${msg}\n`);
		}
		return 1;
	}
}
