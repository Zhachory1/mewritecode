// T-081, T-082: ONNX model + vocab download with SHA256 checksum gate.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ModelManifest {
	url: string;
	sha256: string;
	filename: string;
	sizeBytes: number;
	/** URL for the vocab.txt file (required for tokenization). */
	vocabUrl?: string;
	/** Filename for the vocab file in the models directory. */
	vocabFilename?: string;
	/** SHA256 of the vocab file (empty string to skip verification). */
	vocabSha256?: string;
}

/**
 * LLMLingua-2 BERT-base multilingual model — INT8 quantized ONNX.
 *
 * Quantized via ONNX Runtime dynamic quantization from the fp32 original.
 * ~110MB vs 710MB fp32. SHA256 placeholder until artifact is pinned.
 */
export const LLMLINGUA2_MANIFEST: ModelManifest = {
	url: "https://huggingface.co/microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank/resolve/main/onnx/model_quantized.onnx",
	sha256: "",
	filename: "llmlingua2-bert-base-q8.onnx",
	sizeBytes: 110_000_000,
	vocabUrl: "https://huggingface.co/google-bert/bert-base-multilingual-cased/resolve/main/vocab.txt",
	vocabFilename: "llmlingua2-bert-base.vocab.txt",
	vocabSha256: "",
};

export function modelsDir(configDirName = ".cave"): string {
	return join(homedir(), configDirName, "models");
}

export function modelPath(manifest: ModelManifest, configDirName = ".cave"): string {
	return join(modelsDir(configDirName), manifest.filename);
}

export function vocabPath(manifest: ModelManifest, configDirName = ".cave"): string {
	return join(modelsDir(configDirName), manifest.vocabFilename ?? "vocab.txt");
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
}

export async function isModelCached(manifest: ModelManifest, configDirName = ".cave"): Promise<boolean> {
	const modelOk = await fileExists(modelPath(manifest, configDirName));
	if (!modelOk) return false;
	// If manifest has vocab, check that too
	if (manifest.vocabFilename) {
		return fileExists(vocabPath(manifest, configDirName));
	}
	return true;
}

export async function verifyChecksum(filePath: string, expected: string): Promise<boolean> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk as Buffer);
	}
	return hash.digest("hex") === expected;
}

export interface DownloadProgress {
	bytesDownloaded: number;
	totalBytes: number;
	artifact: string;
}

/**
 * Inactivity budget for a model-artifact download. The `fetch` and the streamed
 * body read were previously unbounded, so a download host that opened the
 * connection then went silent would hang the first-compression turn forever
 * (see issue #143). A single progress-driven watchdog covers both a connect /
 * first-byte stall and a mid-download stall: the timer resets on every received
 * chunk, so a slow-but-progressing download is never killed. Default 60s of
 * inactivity; override via env, `0` disables. Mirrors the CAVE_*_IDLE_TIMEOUT_MS
 * convention used by the stream and compaction watchdogs.
 */
const DEFAULT_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

export function resolveModelDownloadIdleTimeoutMs(): number {
	const raw = process.env.CAVE_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS;
	if (raw === undefined) return DEFAULT_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MODEL_DOWNLOAD_IDLE_TIMEOUT_MS;
}

/** Error thrown when a model download makes no progress within the idle window. */
export class ModelDownloadStalledError extends Error {
	constructor(
		public readonly artifact: string,
		public readonly idleMs: number,
	) {
		super(`model download stalled (${artifact}): no data for ${idleMs}ms`);
		this.name = "ModelDownloadStalledError";
	}
}

/** Download a single artifact to the models directory with checksum verification. */
async function downloadArtifact(
	url: string,
	destPath: string,
	sha256: string,
	sizeBytes: number,
	artifactName: string,
	onProgress?: (progress: DownloadProgress) => void,
	configDirName = ".cave",
): Promise<void> {
	const dir = modelsDir(configDirName);
	await mkdir(dir, { recursive: true });

	const tmp = `${destPath}.tmp`;

	// Already cached + valid?
	if (await fileExists(destPath)) {
		if (sha256) {
			const valid = await verifyChecksum(destPath, sha256);
			if (valid) return;
			await unlink(destPath).catch(() => {});
		} else {
			return;
		}
	}

	// Progress-driven inactivity watchdog: abort the fetch + body read if no
	// bytes arrive within the idle window. Reset on every chunk so a slow but
	// progressing download survives; a connect or mid-stream stall aborts fast.
	const idleMs = resolveModelDownloadIdleTimeoutMs();
	const controller = new AbortController();
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let stalled = false;
	const resetIdle = () => {
		if (idleMs <= 0) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			stalled = true;
			controller.abort();
		}, idleMs);
	};
	const clearIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = undefined;
	};

	try {
		resetIdle();
		const response = await fetch(url, { redirect: "follow", signal: controller.signal });
		if (!response.ok) {
			throw new Error(`download failed (${artifactName}): ${response.status} ${response.statusText}`);
		}
		if (!response.body) {
			throw new Error(`download failed (${artifactName}): empty response body`);
		}

		const writer = createWriteStream(tmp);
		const reader = Readable.fromWeb(response.body as any);
		let bytesDownloaded = 0;

		reader.on("data", (chunk: Buffer) => {
			bytesDownloaded += chunk.length;
			resetIdle();
			onProgress?.({ bytesDownloaded, totalBytes: sizeBytes, artifact: artifactName });
		});

		await pipeline(reader, writer, { signal: controller.signal });
	} catch (err) {
		clearIdle();
		await unlink(tmp).catch(() => {});
		if (stalled || (err instanceof Error && err.name === "AbortError")) {
			throw new ModelDownloadStalledError(artifactName, idleMs);
		}
		throw err;
	}
	clearIdle();

	if (sha256) {
		const valid = await verifyChecksum(tmp, sha256);
		if (!valid) {
			await unlink(tmp).catch(() => {});
			throw new Error(`checksum mismatch: ${artifactName}`);
		}
	}

	await rename(tmp, destPath);
}

/** Download model ONNX file + vocab.txt if not cached. */
export async function downloadModel(
	manifest: ModelManifest,
	onProgress?: (progress: DownloadProgress) => void,
	configDirName = ".cave",
): Promise<string> {
	// Download model
	await downloadArtifact(
		manifest.url,
		modelPath(manifest, configDirName),
		manifest.sha256,
		manifest.sizeBytes,
		manifest.filename,
		onProgress,
		configDirName,
	);

	// Download vocab if specified
	if (manifest.vocabUrl && manifest.vocabFilename) {
		await downloadArtifact(
			manifest.vocabUrl,
			vocabPath(manifest, configDirName),
			manifest.vocabSha256 ?? "",
			1_000_000, // vocab.txt is ~1MB
			manifest.vocabFilename,
			onProgress,
			configDirName,
		);
	}

	return modelPath(manifest, configDirName);
}
