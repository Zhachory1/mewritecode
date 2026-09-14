import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	_resetRegistry,
	getTaskOutputPath,
	markTaskFinished,
	pruneTaskArtifacts,
} from "../src/core/background-task-registry.js";

const agentDirEnv = "MEWRITE_CODING_AGENT_DIR";
let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "mewrite-task-retention-"));
	process.env[agentDirEnv] = agentDir;
	_resetRegistry();
});

afterEach(() => {
	_resetRegistry();
	delete process.env[agentDirEnv];
	rmSync(agentDir, { recursive: true, force: true });
});

describe("task artifact retention", () => {
	it("prunes completed artifacts by count while preserving active tasks", () => {
		writeFileSync(getTaskOutputPath("task-0", true), "x");
		const tasksDir = join(agentDir, "tasks");
		for (let index = 1; index < 501; index++) {
			const taskDir = join(tasksDir, `task-${index}`);
			mkdirSync(taskDir);
			writeFileSync(join(taskDir, "output.jsonl"), "x");
		}

		pruneTaskArtifacts();

		expect(readdirSync(tasksDir)).toHaveLength(500);
		expect(existsSync(join(agentDir, "tasks", "task-0"))).toBe(true);
		markTaskFinished("task-0");
	});

	it("prunes completed artifacts above the aggregate byte budget", () => {
		for (let index = 0; index < 3; index++) {
			const outputPath = getTaskOutputPath(`large-${index}`);
			writeFileSync(outputPath, "");
			truncateSync(outputPath, 1024 * 1024 * 1024);
		}

		pruneTaskArtifacts();

		expect(readdirSync(join(agentDir, "tasks"))).toHaveLength(2);
	});
});
