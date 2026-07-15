import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface WorkerEntry {
	name: string;
	url: string;
	token?: string;
	registeredAt: string;
	labels?: Record<string, string>;
}

export interface WorkersFile {
	workers: WorkerEntry[];
}

export function workersFilePath(): string {
	return join(homedir(), ".mewrite", "workers.json");
}

export function legacyWorkersFilePath(): string {
	return join(homedir(), ".cave", "workers.json");
}

export function readWorkers(): WorkersFile {
	const path = existsSync(workersFilePath()) ? workersFilePath() : legacyWorkersFilePath();
	if (!existsSync(path)) return { workers: [] };
	try {
		const raw = readFileSync(path, "utf8");
		return raw.trim() ? (JSON.parse(raw) as WorkersFile) : { workers: [] };
	} catch (err) {
		throw new Error(`failed to parse ${path}: ${err instanceof Error ? err.message : err}`);
	}
}

export function writeWorkers(file: WorkersFile): void {
	const path = workersFilePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function registrationTime(worker: WorkerEntry): number {
	const t = Date.parse(worker.registeredAt);
	return Number.isFinite(t) ? t : 0;
}

export function isValidWorkerName(name: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(name);
}

export function normalizeWorkerBaseUrl(url: string): string {
	const parsed = new URL(url);
	parsed.username = "";
	parsed.password = "";
	parsed.search = "";
	parsed.hash = "";
	parsed.pathname = parsed.pathname.replace(/\/$/, "");
	return parsed.toString().replace(/\/$/, "");
}

export function selectDefaultWorker(file: WorkersFile = readWorkers()): WorkerEntry | undefined {
	return [...file.workers].sort((a, b) => registrationTime(b) - registrationTime(a))[0];
}

export function findWorker(name: string, file: WorkersFile = readWorkers()): WorkerEntry | undefined {
	return file.workers.find((worker) => worker.name === name);
}

export function safeWorkerOrigin(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		parsed.pathname = parsed.pathname === "/" ? "" : parsed.pathname;
		return parsed.toString();
	} catch {
		return "invalid-url";
	}
}

export function workerAttachCommand(workerName: string, sessionId: string): string {
	if (!isValidWorkerName(workerName)) throw new Error(`invalid worker name: ${workerName}`);
	return `mewrite attach --worker ${workerName} ${sessionId}`;
}

export function redactWorkerText(text: string, worker?: WorkerEntry): string {
	let out = text;
	if (worker?.token) {
		out = out.split(worker.token).join("[REDACTED]");
	}
	out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
	out = out.replace(/(token|auth|key|api_key|access_token)=([^\s&]+)/gi, "$1=[REDACTED]");
	out = out.replace(/https?:\/\/([^\s/@]+):([^\s/@]+)@/gi, "https://[REDACTED]@");
	return out;
}
