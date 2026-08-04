import { createHash } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	downloadModel,
	LLMLINGUA2_MANIFEST,
	ModelDownloadStalledError,
	type ModelManifest,
	modelPath,
	modelsDir,
	resolveModelDownloadIdleTimeoutMs,
	verifyChecksum,
	vocabPath,
} from "../compression/model-download.js";

describe("model-download", () => {
	it("modelsDir points to ~/.cave/models", () => {
		expect(modelsDir()).toBe(join(homedir(), ".cave", "models"));
	});

	it("modelPath joins dir + filename", () => {
		expect(modelPath(LLMLINGUA2_MANIFEST)).toBe(join(homedir(), ".cave", "models", LLMLINGUA2_MANIFEST.filename));
	});

	it("accepts a branded config dir", () => {
		expect(modelsDir(".roktcode")).toBe(join(homedir(), ".roktcode", "models"));
		expect(modelPath(LLMLINGUA2_MANIFEST, ".roktcode")).toBe(
			join(homedir(), ".roktcode", "models", LLMLINGUA2_MANIFEST.filename),
		);
	});

	it("vocabPath joins dir + vocabFilename", () => {
		expect(vocabPath(LLMLINGUA2_MANIFEST)).toBe(
			join(homedir(), ".cave", "models", LLMLINGUA2_MANIFEST.vocabFilename!),
		);
	});

	it("verifyChecksum passes for matching hash", async () => {
		const dir = modelsDir();
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, "__test_checksum.tmp");
		const content = "test content for checksum verification";
		const expected = createHash("sha256").update(content).digest("hex");
		await writeFile(tmp, content);
		try {
			expect(await verifyChecksum(tmp, expected)).toBe(true);
		} finally {
			await unlink(tmp).catch(() => {});
		}
	});

	it("verifyChecksum fails for wrong hash", async () => {
		const dir = modelsDir();
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, "__test_checksum2.tmp");
		await writeFile(tmp, "test");
		try {
			expect(await verifyChecksum(tmp, "0000")).toBe(false);
		} finally {
			await unlink(tmp).catch(() => {});
		}
	});

	it("LLMLINGUA2_MANIFEST has required fields", () => {
		expect(LLMLINGUA2_MANIFEST.url).toContain("huggingface.co");
		expect(LLMLINGUA2_MANIFEST.filename).toContain("llmlingua2");
		expect(LLMLINGUA2_MANIFEST.sizeBytes).toBeGreaterThan(0);
		expect(LLMLINGUA2_MANIFEST.vocabUrl).toContain("vocab.txt");
		expect(LLMLINGUA2_MANIFEST.vocabFilename).toBeDefined();
	});
});

describe("model-download idle timeout (issue #143)", () => {
	afterEach(() => {
		delete process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS;
		vi.unstubAllGlobals();
	});

	it("defaults to 60000ms and honors / validates the env override", () => {
		delete process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS;
		expect(resolveModelDownloadIdleTimeoutMs()).toBe(60_000);
		process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = "5000";
		expect(resolveModelDownloadIdleTimeoutMs()).toBe(5000);
		process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = "0";
		expect(resolveModelDownloadIdleTimeoutMs()).toBe(0);
		process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = "garbage";
		expect(resolveModelDownloadIdleTimeoutMs()).toBe(60_000);
	});

	it("aborts and throws ModelDownloadStalledError when the body stalls", async () => {
		process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = "30";
		const configDir = `.cave-test-${Date.now()}`;

		// Body stream that emits one chunk then hangs forever (never ends) — a
		// classic mid-download stall. The watchdog must abort it.
		const body = new Readable({ read() {} });
		body.push(Buffer.from("partial"));
		// deliberately never push(null) / never push more

		const fetchMock = vi.fn(async (_url: any, init?: any) => {
			const signal: AbortSignal | undefined = init?.signal;
			if (signal) signal.addEventListener("abort", () => body.destroy(new Error("aborted by signal")));
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				body: Readable.toWeb(body) as any,
			} as any;
		});
		vi.stubGlobal("fetch", fetchMock);

		const manifest: ModelManifest = {
			url: "https://example.test/model.onnx",
			sha256: "",
			filename: "stall-test.onnx",
			sizeBytes: 1000,
		};

		try {
			await expect(downloadModel(manifest, undefined, configDir)).rejects.toBeInstanceOf(ModelDownloadStalledError);
		} finally {
			await rm(join(homedir(), configDir), { recursive: true, force: true }).catch(() => {});
		}
	});

	it("completes a normal (non-stalling) download", async () => {
		process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = "1000";
		const configDir = `.cave-test-${Date.now()}-ok`;

		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			body: Readable.toWeb(Readable.from([Buffer.from("model-bytes")])) as any,
		}));
		vi.stubGlobal("fetch", fetchMock);

		const manifest: ModelManifest = {
			url: "https://example.test/model.onnx",
			sha256: "",
			filename: "ok-test.onnx",
			sizeBytes: 11,
		};

		try {
			const path = await downloadModel(manifest, undefined, configDir);
			expect(path).toBe(modelPath(manifest, configDir));
		} finally {
			await rm(join(homedir(), configDir), { recursive: true, force: true }).catch(() => {});
		}
	});
});
