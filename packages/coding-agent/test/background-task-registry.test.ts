import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	truncateSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	_resetRegistry,
	getTaskOutputPath,
	markTaskActive,
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
	it("prunes completed artifacts by count while preserving active tasks", async () => {
		writeFileSync(getTaskOutputPath("task-0", true), "x");
		const tasksDir = join(agentDir, "tasks");
		for (let index = 1; index < 651; index++) {
			const taskDir = join(tasksDir, `task-${index}`);
			mkdirSync(taskDir);
			writeFileSync(join(taskDir, "output.jsonl"), "x");
		}

		pruneTaskArtifacts();
		for (let attempt = 0; attempt < 100 && readdirSync(tasksDir).length > 500; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(readdirSync(tasksDir)).toHaveLength(500);
		expect(existsSync(join(agentDir, "tasks", "task-0"))).toBe(true);
		markTaskFinished("task-0");
	});

	it("prunes completed artifacts above the aggregate byte budget", async () => {
		for (let index = 0; index < 5; index++) {
			const outputPath = getTaskOutputPath(`large-${index}`);
			writeFileSync(outputPath, "");
			truncateSync(outputPath, 512 * 1024 * 1024);
		}

		pruneTaskArtifacts();
		const tasksDir = join(agentDir, "tasks");
		for (let attempt = 0; attempt < 100 && readdirSync(tasksDir).length > 4; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(readdirSync(tasksDir)).toHaveLength(4);
	});

	it("refreshes active marker leases", async () => {
		const outputPath = getTaskOutputPath("active", true);
		writeFileSync(outputPath, "");
		truncateSync(outputPath, 1024 * 1024 * 1024);
		const taskDir = join(agentDir, "tasks", "active");
		const marker = readdirSync(taskDir).find((name) => name.startsWith(".active-"))!;
		const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(join(taskDir, marker), old, old);
		utimesSync(taskDir, old, old);
		markTaskActive("active");
		for (let index = 0; index < 2; index++) {
			const path = getTaskOutputPath(`large-${index}`);
			writeFileSync(path, "");
			truncateSync(path, 1024 * 1024 * 1024);
		}

		pruneTaskArtifacts();
		for (let attempt = 0; attempt < 100 && readdirSync(join(agentDir, "tasks")).length > 2; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(existsSync(taskDir)).toBe(true);
	});

	it("retries orphaned prune directories", async () => {
		getTaskOutputPath("seed");
		const pruneDir = join(agentDir, "tasks", ".prune-orphan");
		mkdirSync(pruneDir);
		writeFileSync(join(pruneDir, "output.jsonl"), "x");

		pruneTaskArtifacts();
		for (let attempt = 0; attempt < 100 && existsSync(pruneDir); attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(existsSync(pruneDir)).toBe(false);
	});

	it("expires stale liveness markers even when their PID was reused", async () => {
		const outputPath = getTaskOutputPath("stale-active", true);
		writeFileSync(outputPath, "");
		truncateSync(outputPath, 1024 * 1024 * 1024);
		const taskDir = join(agentDir, "tasks", "stale-active");
		const marker = readdirSync(taskDir).find((name) => name.startsWith(".active-"))!;
		const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(join(taskDir, marker), old, old);
		utimesSync(taskDir, old, old);
		for (let index = 0; index < 2; index++) {
			const path = getTaskOutputPath(`large-${index}`);
			writeFileSync(path, "");
			truncateSync(path, 1024 * 1024 * 1024);
		}

		pruneTaskArtifacts();
		for (let attempt = 0; attempt < 100 && existsSync(taskDir); attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(existsSync(taskDir)).toBe(false);
	});
});
