/**
 * WS18 - watch-agent-run: agent dispatch shim for watch triggers.
 *
 * Kept in a separate module so watch.ts can dynamically import it
 * (avoids loading the entire agent runtime at watcher startup).
 *
 * The full agent wiring (createAgentSessionRuntime + runPrintMode)
 * is performed in main.ts when the user is in interactive mode via
 * the /watch slash command, which wires a real agentRun callback.
 * In standalone watch mode this shim emits the prompt to stderr
 * and delegates to the current binary via a child process.
 */

import { spawn } from "node:child_process";
import chalk from "chalk";
import { APP_NAME, WATCH_FIRE_MARKER, WATCH_QA_MARKER } from "../config.js";

export interface WatchAgentRunOptions {
	model?: string;
	noSession?: boolean;
}

/**
 * Run the agent for a single watch trigger.
 *
 * Spawns the current binary with `-p <prompt>` as a child process so the full session
 * runtime initialises cleanly. Captures stdout and returns it as
 * the response string.
 *
 * isReadOnly=true passes --tools read,grep,find,ls so the
 * agent cannot write files.
 */
export async function runWatchAgentRun(
	prompt: string,
	filePath: string,
	isReadOnly: boolean,
	options: WatchAgentRunOptions = {},
): Promise<string> {
	const marker = isReadOnly ? WATCH_QA_MARKER : WATCH_FIRE_MARKER;
	process.stderr.write(chalk.cyan(`[${APP_NAME} watch] ${marker} triggered in ${filePath} — running agent...\n`));

	const mewriteBin = process.argv[1]; // same binary that is running

	const cliArgs = ["-p", prompt];
	if (options.noSession) cliArgs.push("--no-session");
	if (options.model) {
		cliArgs.push("--model", options.model);
	}
	if (isReadOnly) {
		cliArgs.push("--tools", "read,grep,find,ls");
	}

	return new Promise<string>((resolve) => {
		let stdout = "";
		let stderr = "";

		const child = spawn(process.execPath, [mewriteBin, ...cliArgs], {
			stdio: ["ignore", "pipe", "pipe"],
			cwd: process.cwd(),
			env: process.env,
		});

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			if (stderr) {
				process.stderr.write(chalk.dim(stderr));
			}
			if (code !== 0) {
				process.stderr.write(chalk.yellow(`[${APP_NAME} watch] agent exited with code ${code}\n`));
			}
			resolve(stdout.trim());
		});

		child.on("error", (err) => {
			process.stderr.write(chalk.red(`[${APP_NAME} watch] failed to spawn agent: ${err.message}\n`));
			resolve("");
		});
	});
}
