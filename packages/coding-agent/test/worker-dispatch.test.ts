import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchWorkerPrompt, parseWorkerPrompt, WorkerDispatchError } from "../src/core/worker-dispatch.js";
import {
	isValidWorkerName,
	normalizeWorkerBaseUrl,
	readWorkers,
	safeWorkerOrigin,
	selectDefaultWorker,
	workerAttachCommand,
} from "../src/core/worker-registry.js";

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
	originalHome = process.env.HOME;
	originalUserProfile = process.env.USERPROFILE;
	tmpHome = mkdtempSync(join(tmpdir(), "worker-dispatch-test-"));
	process.env.HOME = tmpHome;
	process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
	rmSync(tmpHome, { recursive: true, force: true });
});

function writeWorkersJson(workers: unknown[]): void {
	const dir = join(tmpHome, ".mewrite");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "workers.json"), JSON.stringify({ workers }), { flag: "w" });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw ? JSON.parse(raw) : undefined;
}

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void): Promise<{
	url: string;
	close: () => Promise<void>;
}> {
	const server = createServer((req, res) => void handler(req, res));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing server address");
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
	};
}

describe("parseWorkerPrompt", () => {
	it("parses ampersand-prefixed prompts only", () => {
		expect(parseWorkerPrompt("&run tests")).toEqual({ ok: true, prompt: "run tests" });
		expect(parseWorkerPrompt("  &  run tests  ")).toEqual({ ok: true, prompt: "run tests" });
		expect(parseWorkerPrompt("&   ")).toEqual({ ok: false, reason: "empty" });
		expect(parseWorkerPrompt("run tests")).toEqual({ ok: false, reason: "not-worker" });
	});
});

describe("worker registry helpers", () => {
	it("selects the most recently registered worker and formats token-safe attach command", () => {
		writeWorkersJson([
			{ name: "old", url: "http://old", registeredAt: "2026-01-01T00:00:00.000Z" },
			{ name: "new", url: "http://new", token: "secret", registeredAt: "2026-01-02T00:00:00.000Z" },
		]);

		const file = readWorkers();
		expect(selectDefaultWorker(file)?.name).toBe("new");
		expect(workerAttachCommand("new", "session-1")).toBe("mewrite attach --worker new session-1");
	});

	it("keeps attach hints shell-safe with strict worker names", () => {
		expect(isValidWorkerName("gpu-1.prod_ok")).toBe(true);
		expect(isValidWorkerName("gpu prod")).toBe(false);
		expect(isValidWorkerName("gpu;rm-rf")).toBe(false);
		expect(() => workerAttachCommand("gpu prod", "session-1")).toThrow(/invalid worker name/);
	});

	it("normalizes trailing slash worker URLs", () => {
		expect(normalizeWorkerBaseUrl("http://127.0.0.1:7421/")).toBe("http://127.0.0.1:7421");
	});

	it("redacts credentials and query params from display URLs", () => {
		expect(safeWorkerOrigin("http://user:pass@example.test:7421/path?token=secret&ok=leak")).toBe(
			"http://example.test:7421/path",
		);
	});
});

describe("dispatchWorkerPrompt", () => {
	it("creates a remote session and sends the prompt", async () => {
		const calls: Array<{ path: string; body: unknown; auth?: string }> = [];
		const server = await withServer(async (req, res) => {
			calls.push({ path: req.url ?? "", body: await readBody(req), auth: req.headers.authorization });
			res.setHeader("content-type", "application/json");
			if (req.url === "/v1/sessions") {
				res.end(JSON.stringify({ id: "remote-1", createdAt: "", updatedAt: "", state: "idle", cwd: "/work" }));
				return;
			}
			if (req.url === "/v1/sessions/remote-1/messages") {
				res.end(
					JSON.stringify({ id: "msg-1", sessionId: "remote-1", role: "user", text: "ship it", createdAt: "" }),
				);
				return;
			}
			res.statusCode = 404;
			res.end(JSON.stringify({ error: "nope" }));
		});

		const result = await dispatchWorkerPrompt({
			worker: { name: "gpu", url: server.url, token: "secret-token", registeredAt: "now" },
			prompt: "ship it",
			cwd: "/repo",
			timeoutMs: 1000,
		});

		expect(result).toEqual({
			workerName: "gpu",
			sessionId: "remote-1",
			attachCommand: "mewrite attach --worker gpu remote-1",
		});
		expect(calls.map((call) => call.path)).toEqual(["/v1/sessions", "/v1/sessions/remote-1/messages"]);
		expect(calls[0].body).toEqual({ cwd: "/repo", worker: "gpu" });
		expect(calls[1].body).toEqual({ text: "ship it", worker: "gpu" });
		expect(calls.every((call) => call.auth === "Bearer secret-token")).toBe(true);
		await server.close();
	});

	it("fails without workers", async () => {
		await expect(dispatchWorkerPrompt({ prompt: "hi", cwd: "/repo", timeoutMs: 1 })).rejects.toMatchObject({
			kind: "no-worker",
		});
	});

	it("redacts tokens from remote errors", async () => {
		const server = await withServer((_req, res) => {
			res.statusCode = 403;
			res.end(JSON.stringify({ error: "bad secret-token token=secret-token" }));
		});

		await expect(
			dispatchWorkerPrompt({
				worker: { name: "gpu", url: server.url, token: "secret-token", registeredAt: "now" },
				prompt: "hi",
				cwd: "/repo",
				timeoutMs: 1000,
			}),
		).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(WorkerDispatchError);
			expect(String((error as Error).message)).not.toContain("secret-token");
			expect((error as WorkerDispatchError).kind).toBe("auth");
			return true;
		});
		await server.close();
	});

	it("reports send failure after session create with session id", async () => {
		const server = await withServer(async (req, res) => {
			await readBody(req);
			res.setHeader("content-type", "application/json");
			if (req.url === "/v1/sessions") {
				res.end(JSON.stringify({ id: "remote-1", createdAt: "", updatedAt: "", state: "idle", cwd: "/work" }));
				return;
			}
			res.statusCode = 500;
			res.end(JSON.stringify({ error: "send failed" }));
		});

		await expect(
			dispatchWorkerPrompt({
				worker: { name: "gpu", url: server.url, registeredAt: "now" },
				prompt: "hi",
				cwd: "/repo",
				timeoutMs: 1000,
			}),
		).rejects.toMatchObject({ kind: "send-failed-after-create", sessionId: "remote-1" });
		await server.close();
	});
});
