/**
 * WS17: `cave rollback` CLI command handler.
 *
 * Usage:
 *   cave rollback [N] [--file <path>]   — roll back N steps (default 1)
 *   cave rollback list                   — show last 20 snapshots
 *
 * Returns true if the command was handled (so main.ts can early-return).
 */

import { relative, resolve } from "node:path";
import { checkpoints } from "@caveman-code/agent";
import chalk from "chalk";

const { CheckpointManager } = checkpoints;

export async function handleRollbackCommand(argv: string[]): Promise<boolean> {
	if (argv[0] !== "rollback") return false;

	const sub = argv[1];

	if (sub === "list") {
		return handleList();
	}

	return handleRollback(argv.slice(1));
}

async function handleList(): Promise<boolean> {
	const cwd = process.cwd();
	const mgr = new CheckpointManager(cwd);
	const entries = mgr.list(20);

	if (entries.length === 0) {
		console.log(chalk.dim("No checkpoints recorded for this project."));
		return true;
	}

	console.log(chalk.bold("\nCheckpoints (newest first):\n"));
	for (const e of entries) {
		const date = new Date(e.ts).toLocaleString();
		const reason = formatReason(e.reason);
		const files = e.fileCount === 1 ? "1 file" : `${e.fileCount} files`;
		console.log(
			`  ${chalk.cyan(`#${e.id}`)}  ${chalk.dim(date)}  ${chalk.yellow(reason)}  ${chalk.dim(files)}  ${chalk.dim(e.commit)}`,
		);
	}
	console.log();
	return true;
}

async function handleRollback(args: string[]): Promise<boolean> {
	// Parse: [N] [--file <path>]
	let steps = 1;
	let filePath: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--file" || arg === "-f") {
			filePath = args[++i];
		} else if (/^\d+$/.test(arg ?? "")) {
			steps = Number.parseInt(arg ?? "1", 10);
		}
	}

	const cwd = process.cwd();

	// Normalize file path to repo-relative if absolute
	let repoRelFile: string | undefined;
	if (filePath) {
		const abs = resolve(cwd, filePath);
		repoRelFile = relative(cwd, abs);
	}

	const mgr = new CheckpointManager(cwd);

	const totalSnapshots = mgr.getIndex().entries().length;
	if (totalSnapshots === 0) {
		console.error(chalk.yellow("No checkpoints recorded for this project. Nothing to roll back."));
		process.exit(0);
	}

	if (steps > totalSnapshots) {
		console.error(
			chalk.yellow(
				`Requested ${steps} step(s) back but only ${totalSnapshots} snapshot(s) exist. Clamping to ${totalSnapshots}.`,
			),
		);
		steps = totalSnapshots;
	}

	console.log(chalk.dim(`Rolling back ${steps} step(s)${repoRelFile ? ` (file: ${repoRelFile})` : ""}…`));

	const result = await mgr.rollback(steps, repoRelFile ? { file: repoRelFile } : {});

	switch (result.status) {
		case "ok": {
			const fileList = result.restoredFiles.length > 0 ? result.restoredFiles.join(", ") : "(none)";
			console.log(chalk.green(`Rolled back to checkpoint #${result.entry?.id} (${result.entry?.reason}).`));
			console.log(chalk.dim(`Restored: ${fileList}  (${result.durationMs}ms)`));
			break;
		}
		case "not_found":
			console.error(chalk.red(`Rollback failed: ${result.error ?? "checkpoint not found"}`));
			process.exit(1);
			break;
		case "error":
			console.error(chalk.red(`Rollback error: ${result.error ?? "unknown error"}`));
			process.exit(1);
			break;
	}

	return true;
}

function formatReason(reason: string): string {
	if (reason === "pre-write") return "write";
	if (reason === "pre-edit") return "edit";
	if (reason === "pre-bash") return "bash";
	if (reason.startsWith("manual:")) return `manual(${reason.slice(7)})`;
	return reason;
}
