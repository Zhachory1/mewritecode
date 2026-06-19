/**
 * Status line runner — invokes the user-configured `statusLine.command`
 * (Claude Code v2.1.119 schema) and returns the resolved text.
 *
 * Schema source: see `parseStatusLineSettings` in `@zhachory1/mewrite-tui`. The command
 * receives a JSON `StatusLineContext` payload on stdin and writes a single
 * line to stdout. Stderr surfaces in `/doctor`. Timeouts cap at 1.5s so a
 * misbehaving script never blocks the TUI redraw loop.
 */
import { spawn } from "node:child_process";
import type {
	StatusLineContext,
	StatusLineRenderer,
	StatusLineResult,
	StatusLineSettings,
} from "@zhachory1/mewrite-tui";
import {
	parseStatusLineSettings,
	renderStatusLineDefault,
	renderStatusLineDetailed,
	sanitizeOneLine,
} from "@zhachory1/mewrite-tui";

export const STATUS_LINE_TIMEOUT_MS = 1500;

/**
 * Build a StatusLineRenderer from a raw `settings.json` `statusLine` block.
 *
 * - `default` and `detailed` resolve synchronously without spawning.
 * - `command` spawns the configured binary with the JSON context on stdin.
 * - Malformed settings fall back to the default renderer.
 */
export function createStatusLineRenderer(raw: unknown): StatusLineRenderer {
	const parsed = parseStatusLineSettings(raw);
	return new StatusLineRunnerImpl(parsed);
}

class StatusLineRunnerImpl implements StatusLineRenderer {
	constructor(private settings: StatusLineSettings | undefined) {}

	async render(ctx: StatusLineContext): Promise<StatusLineResult> {
		const type = this.settings?.type ?? "default";

		if (type === "detailed") {
			return { text: renderStatusLineDetailed(ctx), source: "detailed" };
		}
		if (type === "command" && this.settings?.command) {
			return runCommand(this.settings.command, ctx);
		}
		return { text: renderStatusLineDefault(ctx), source: "default" };
	}
}

async function runCommand(command: string, ctx: StatusLineContext): Promise<StatusLineResult> {
	return new Promise((resolve) => {
		const shell = process.env.SHELL || (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");
		const shellFlag = process.platform === "win32" ? "/c" : "-c";
		let stdout = "";
		let stderr = "";
		let settled = false;

		const child = spawn(shell, [shellFlag, command], {
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				child.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			resolve({
				text: renderStatusLineDefault(ctx),
				source: "command-failed",
				stderr: `status line command timed out after ${STATUS_LINE_TIMEOUT_MS}ms`,
			});
		}, STATUS_LINE_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.stdin.on("error", () => {
			// The command may exit before it reads stdin. Treat that as command outcome,
			// not a process-level unhandled error.
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				text: renderStatusLineDefault(ctx),
				source: "command-failed",
				stderr: `status line command spawn failed: ${err.message}`,
			});
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code !== 0) {
				resolve({
					text: renderStatusLineDefault(ctx),
					source: "command-failed",
					stderr: stderr.trim() || `status line command exited with code ${code}`,
				});
				return;
			}
			resolve({ text: sanitizeOneLine(stdout), source: "command", stderr: stderr.trim() || undefined });
		});

		try {
			child.stdin.write(JSON.stringify(ctx));
			child.stdin.end();
		} catch {
			// Will surface via 'error' event.
		}
	});
}
