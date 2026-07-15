import type { MessageRecord, SessionRecord } from "./daemon/protocol.js";
import {
	normalizeWorkerBaseUrl,
	redactWorkerText,
	safeWorkerOrigin,
	selectDefaultWorker,
	type WorkerEntry,
	workerAttachCommand,
} from "./worker-registry.js";

export type WorkerPromptParseResult = { ok: true; prompt: string } | { ok: false; reason: "not-worker" | "empty" };

export interface WorkerDispatchResult {
	workerName: string;
	sessionId: string;
	attachCommand: string;
}

export type WorkerDispatchErrorKind =
	| "no-worker"
	| "invalid-worker-url"
	| "timeout"
	| "network"
	| "auth"
	| "http"
	| "send-failed-after-create";

export class WorkerDispatchError extends Error {
	constructor(
		readonly kind: WorkerDispatchErrorKind,
		message: string,
		readonly sessionId?: string,
	) {
		super(message);
		this.name = "WorkerDispatchError";
	}
}

export interface DispatchWorkerPromptOptions {
	worker?: WorkerEntry;
	prompt: string;
	cwd: string;
	timeoutMs?: number;
}

export function parseWorkerPrompt(text: string): WorkerPromptParseResult {
	if (!text.trimStart().startsWith("&")) return { ok: false, reason: "not-worker" };
	const prompt = text.trimStart().slice(1).trim();
	if (!prompt) return { ok: false, reason: "empty" };
	return { ok: true, prompt };
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), Math.max(1, timeoutMs));
	return {
		signal: controller.signal,
		cancel: () => clearTimeout(timer),
	};
}

function baseUrl(worker: WorkerEntry): string {
	try {
		return normalizeWorkerBaseUrl(worker.url);
	} catch {
		throw new WorkerDispatchError(
			"invalid-worker-url",
			`Worker ${worker.name} has invalid URL: ${safeWorkerOrigin(worker.url)}`,
		);
	}
}

async function requestJson<T>(
	worker: WorkerEntry,
	method: string,
	path: string,
	body: unknown,
	timeoutMs: number,
): Promise<T> {
	const timeout = timeoutSignal(timeoutMs);
	try {
		const res = await fetch(`${baseUrl(worker)}${path}`, {
			method,
			signal: timeout.signal,
			headers: {
				"content-type": "application/json",
				...(worker.token ? { authorization: `Bearer ${worker.token}` } : {}),
			},
			body: JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			const message = redactWorkerText(text || res.statusText, worker);
			const kind: WorkerDispatchErrorKind = res.status === 401 || res.status === 403 ? "auth" : "http";
			throw new WorkerDispatchError(
				kind,
				`Worker ${worker.name} ${method} ${path} failed (${res.status}): ${message}`,
			);
		}
		return text ? (JSON.parse(text) as T) : (undefined as T);
	} catch (error) {
		if (error instanceof WorkerDispatchError) throw error;
		if (timeout.signal.aborted) {
			throw new WorkerDispatchError("timeout", `Worker ${worker.name} timed out at ${safeWorkerOrigin(worker.url)}`);
		}
		throw new WorkerDispatchError(
			"network",
			`Worker ${worker.name} is unreachable at ${safeWorkerOrigin(worker.url)}: ${redactWorkerText(error instanceof Error ? error.message : String(error), worker)}`,
		);
	} finally {
		timeout.cancel();
	}
}

export async function dispatchWorkerPrompt(options: DispatchWorkerPromptOptions): Promise<WorkerDispatchResult> {
	const worker = options.worker ?? selectDefaultWorker();
	if (!worker) {
		throw new WorkerDispatchError(
			"no-worker",
			"No workers registered. Run `mewrite worker register <name> --url <url>`.",
		);
	}
	const timeoutMs = options.timeoutMs ?? 10_000;
	let session: SessionRecord;
	try {
		session = await requestJson<SessionRecord>(
			worker,
			"POST",
			"/v1/sessions",
			{ cwd: options.cwd, worker: worker.name },
			timeoutMs,
		);
	} catch (error) {
		if (error instanceof WorkerDispatchError) throw error;
		throw new WorkerDispatchError("network", `Worker ${worker.name} failed to create a session.`);
	}
	try {
		await requestJson<MessageRecord>(
			worker,
			"POST",
			`/v1/sessions/${encodeURIComponent(session.id)}/messages`,
			{ text: options.prompt, worker: worker.name },
			timeoutMs,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new WorkerDispatchError(
			"send-failed-after-create",
			`Worker ${worker.name} created remote session ${session.id}, but sending the prompt failed: ${redactWorkerText(message, worker)}`,
			session.id,
		);
	}
	return {
		workerName: worker.name,
		sessionId: session.id,
		attachCommand: workerAttachCommand(worker.name, session.id),
	};
}
