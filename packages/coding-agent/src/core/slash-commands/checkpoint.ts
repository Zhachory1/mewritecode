/**
 * WS17: `/checkpoint <name>` slash command.
 *
 * Takes a labeled manual snapshot of the current project state into the
 * shadow git repo. Useful before a risky refactor so you can `cave rollback`
 * to a named point.
 *
 * Usage inside interactive session:
 *   /checkpoint before-refactor
 *   /checkpoint my backup label
 */

import { checkpoints } from "@zhachory1/mewrite-agent";

const { CheckpointManager } = checkpoints;

export interface CheckpointCommandIO {
	/** Absolute path to the project root (= cwd for most sessions). */
	projectRoot: string;
	/** Current session ID (for tagging the commit). */
	sessionId: string;
}

export interface CheckpointCommandResult {
	exitCode: number;
	output: string;
}

/**
 * Execute the /checkpoint command.
 *
 * @param args   The raw argument string after "/checkpoint " (trimmed).
 * @param io     Runtime context.
 */
export async function runCheckpointCommand(args: string, io: CheckpointCommandIO): Promise<CheckpointCommandResult> {
	const name = args.trim();

	if (!name) {
		return {
			exitCode: 1,
			output:
				"Usage: /checkpoint <name>\n" +
				"Example: /checkpoint before-refactor\n" +
				"\n" +
				"Creates a labeled snapshot of the current project state.\n" +
				"Use `cave rollback` to restore to any snapshot.",
		};
	}

	try {
		const mgr = new CheckpointManager(io.projectRoot);
		const result = await mgr.manualSnapshot(name, io.sessionId);

		const fileCount = result.files.length;
		const fileSummary = fileCount === 0 ? "no files tracked" : fileCount === 1 ? "1 file" : `${fileCount} files`;

		return {
			exitCode: 0,
			output:
				`Checkpoint "${name}" created.\n` +
				`  Commit: ${result.commit.slice(0, 12)}\n` +
				`  Captured: ${fileSummary}\n` +
				`  Duration: ${result.durationMs}ms\n` +
				"\n" +
				"Use `cave rollback` to restore, or `cave rollback list` to see all checkpoints.",
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			exitCode: 1,
			output: `Failed to create checkpoint: ${message}`,
		};
	}
}
