import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { SettingsManager } from "../core/settings-manager.js";
import type { DiagnosticsEvent, DiagnosticsFileName } from "./events.js";
import { fileNameForEvent } from "./events.js";

export const DIAGNOSTICS_RETENTION_DAYS = 30;
export const DIAGNOSTICS_RETENTION_BYTES = 50 * 1024 * 1024;

export interface DiagnosticsPaths {
	rootDir: string;
	currentDir: string;
	archiveDir: string;
	exportsDir: string;
}

export function getDiagnosticsPaths(agentDir: string): DiagnosticsPaths {
	const rootDir = join(agentDir, "diagnostics");
	return {
		rootDir,
		currentDir: join(rootDir, "current"),
		archiveDir: join(rootDir, "archive"),
		exportsDir: join(rootDir, "exports"),
	};
}

export function ensureDiagnosticsDirs(paths: DiagnosticsPaths): void {
	mkdirSync(paths.currentDir, { recursive: true, mode: 0o700 });
	mkdirSync(paths.archiveDir, { recursive: true, mode: 0o700 });
	mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 });
}

export function appendDiagnosticsEvent(agentDir: string, event: DiagnosticsEvent): void {
	const paths = getDiagnosticsPaths(agentDir);
	ensureDiagnosticsDirs(paths);
	appendFileSync(join(paths.currentDir, fileNameForEvent(event.type)), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

export function rotateDiagnostics(agentDir: string, now: Date = new Date()): void {
	const paths = getDiagnosticsPaths(agentDir);
	ensureDiagnosticsDirs(paths);
	const day = now.toISOString().slice(0, 10);
	const archiveDayDir = join(paths.archiveDir, day);
	mkdirSync(archiveDayDir, { recursive: true, mode: 0o700 });
	for (const entry of readdirSync(paths.currentDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		const source = join(paths.currentDir, entry.name);
		const stats = statSync(source);
		if (stats.size === 0) continue;
		if (stats.mtime.toISOString().slice(0, 10) === day) continue;
		const target = join(archiveDayDir, `${Date.now()}-${entry.name}`);
		renameSync(source, target);
	}
	pruneDiagnostics(paths, now);
}

function collectFiles(dir: string): Array<{ path: string; size: number; mtimeMs: number }> {
	if (!existsSync(dir)) return [];
	const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(path));
			continue;
		}
		if (!entry.isFile()) continue;
		const stats = statSync(path);
		files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
	}
	return files;
}

function pruneDiagnostics(paths: DiagnosticsPaths, now: Date): void {
	const cutoff = now.getTime() - DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	for (const file of collectFiles(paths.archiveDir)) {
		if (file.mtimeMs < cutoff) {
			rmSync(file.path, { force: true });
		}
	}
	const files = collectFiles(paths.rootDir).sort((a, b) => b.mtimeMs - a.mtimeMs);
	let total = 0;
	for (const file of files) {
		total += file.size;
		if (total > DIAGNOSTICS_RETENTION_BYTES) {
			rmSync(file.path, { force: true });
		}
	}
}

export interface DiagnosticsInputFile {
	name: DiagnosticsFileName;
	path: string;
	content: string;
}

export function readDiagnosticsInputs(agentDir: string): DiagnosticsInputFile[] {
	const paths = getDiagnosticsPaths(agentDir);
	const files: DiagnosticsInputFile[] = [];
	for (const dir of [paths.currentDir, paths.archiveDir]) {
		for (const file of collectFiles(dir)) {
			const name = basename(file.path).replace(/^\d+-/, "") as DiagnosticsFileName;
			if (!name.endsWith(".jsonl")) continue;
			files.push({ name, path: file.path, content: readFileSync(file.path, "utf-8") });
		}
	}
	return files;
}

export function diagnosticsEnabled(settingsManager: SettingsManager): boolean {
	return settingsManager.getDiagnosticsEnabled();
}
