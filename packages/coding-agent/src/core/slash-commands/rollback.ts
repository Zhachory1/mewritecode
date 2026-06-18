/**
 * WS17: `/rollback [N] [--file <path>]` slash command (in-session variant).
 *
 * The interactive equivalent of `cave rollback`.  Invocable from within an
 * active session so the user doesn't have to drop to a shell.
 *
 * Usage:
 *   /rollback          — roll back 1 step
 *   /rollback 3        — roll back 3 steps
 *   /rollback list     — list last 20 snapshots
 *   /rollback 2 --file src/foo.ts  — restore only that file
 */

import { relative, resolve } from "node:path";
import { checkpoints } from "@zhachory1/mewrite-agent";

const { CheckpointManager } = checkpoints;

export interface RollbackCommandIO {
	/** Absolute path to the project root. */
	projectRoot: string;
}

export interface RollbackCommandResult {
	exitCode: number;
	output: string;
}

export async function runRollbackCommand(args: string, io: RollbackCommandIO): Promise<RollbackCommandResult> {
	const argv = args.trim().split(/\s+/).filter(Boolean);
	const mgr = new CheckpointManager(io.projectRoot);

	if (argv[0] === "list" || argv[0] === "ls") {
		return formatList(mgr);
	}

	// Parse: [N] [--file <path>]
	let steps = 1;
	let filePath: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if ((tok === "--file" || tok === "-f") && argv[i + 1]) {
			filePath = argv[++i];
		} else if (/^\d+$/.test(tok ?? "")) {
			steps = Number.parseInt(tok ?? "1", 10);
		}
	}

	let repoRelFile: string | undefined;
	if (filePath) {
		const abs = resolve(io.projectRoot, filePath);
		repoRelFile = relative(io.projectRoot, abs);
	}

	const total = mgr.getIndex().entries().length;
	if (total === 0) {
		return {
			exitCode: 0,
			output: "No checkpoints recorded for this project. Nothing to roll back.",
		};
	}

	const clampedSteps = Math.min(steps, total);
	const result = await mgr.rollback(clampedSteps, repoRelFile ? { file: repoRelFile } : {});

	if (result.status === "not_found") {
		return {
			exitCode: 1,
			output: `Rollback failed: ${result.error ?? "checkpoint not found"}`,
		};
	}

	if (result.status === "error") {
		return {
			exitCode: 1,
			output: `Rollback error: ${result.error ?? "unknown"}`,
		};
	}

	const fileList = result.restoredFiles.length > 0 ? result.restoredFiles.join(", ") : "(none)";
	return {
		exitCode: 0,
		output:
			`Rolled back to checkpoint #${result.entry?.id} (${result.entry?.reason}).\n` +
			`Restored: ${fileList}\n` +
			`Duration: ${result.durationMs}ms`,
	};
}

function formatList(mgr: InstanceType<typeof CheckpointManager>): RollbackCommandResult {
	const entries = mgr.list(20);
	if (entries.length === 0) {
		return {
			exitCode: 0,
			output: "No checkpoints recorded for this project.",
		};
	}

	const lines = ["Checkpoints (newest first):", ""];
	for (const e of entries) {
		const date = new Date(e.ts).toLocaleString();
		const reason = e.reason;
		const files = e.fileCount === 1 ? "1 file" : `${e.fileCount} files`;
		lines.push(`  #${e.id}  ${date}  ${reason}  ${files}  ${e.commit}`);
	}
	return { exitCode: 0, output: lines.join("\n") };
}
