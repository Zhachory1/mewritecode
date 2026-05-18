/**
 * WS16: Pure argument parsing for `cave exec` — no heavy dependencies.
 * Kept separate so tests can import this without pulling in the full runtime.
 */

import { resolve } from "node:path";

export interface ExecArgs {
	prompt: string;
	json: boolean;
	outputSchema?: string;
	ephemeral: boolean;
	skipGitRepoCheck: boolean;
	outputLastMessage?: string;
	cwd: string;
	model?: string;
	profile?: string;
	timeoutMs?: number;
	help: boolean;
}

export function parseExecArgs(rawArgs: string[]): ExecArgs {
	const result: ExecArgs = {
		prompt: "",
		json: false,
		ephemeral: false,
		skipGitRepoCheck: false,
		cwd: process.cwd(),
		help: false,
	};

	const positionals: string[] = [];

	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--json") {
			result.json = true;
		} else if (arg === "--ephemeral") {
			result.ephemeral = true;
		} else if (arg === "--skip-git-repo-check") {
			result.skipGitRepoCheck = true;
		} else if (arg === "--output-schema" && i + 1 < rawArgs.length) {
			result.outputSchema = rawArgs[++i];
		} else if (arg === "--output-last-message" && i + 1 < rawArgs.length) {
			result.outputLastMessage = rawArgs[++i];
		} else if (arg === "--cwd" && i + 1 < rawArgs.length) {
			result.cwd = resolve(rawArgs[++i]);
		} else if (arg === "--model" && i + 1 < rawArgs.length) {
			result.model = rawArgs[++i];
		} else if (arg === "--profile" && i + 1 < rawArgs.length) {
			result.profile = rawArgs[++i];
		} else if (arg === "--timeout" && i + 1 < rawArgs.length) {
			const ms = parseInt(rawArgs[++i], 10);
			if (!Number.isNaN(ms) && ms > 0) {
				result.timeoutMs = ms;
			}
		} else if (!arg.startsWith("-")) {
			positionals.push(arg);
		}
		// Silently ignore unknown flags to allow forward-compat.
	}

	result.prompt = positionals.join(" ");
	return result;
}
