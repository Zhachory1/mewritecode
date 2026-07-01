import type { ContextBundle, ContextPack } from "./context-engine.js";

export interface ContextCompressionInput {
	id: string;
	content: string;
}

export interface ContextCompressionOutput {
	id: string;
	content: string;
}

export interface ContextCompressor {
	readonly name: string;
	compress(input: ContextCompressionInput, signal?: AbortSignal): Promise<ContextCompressionOutput>;
}

export interface ContextCompressionStats {
	enabled: boolean;
	attempted: number;
	compressed: number;
	skippedExact: number;
	failed: number;
	originalBytes: number;
	outputBytes: number;
	fallbackReason?: string;
}

export interface CompressContextPackOptions {
	enabled: boolean;
	signal?: AbortSignal;
}

export const EMPTY_CONTEXT_COMPRESSION_STATS: ContextCompressionStats = {
	enabled: false,
	attempted: 0,
	compressed: 0,
	skippedExact: 0,
	failed: 0,
	originalBytes: 0,
	outputBytes: 0,
};

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function isLossyOk(bundle: ContextBundle): boolean {
	return bundle.compression?.mode === "lossy-ok";
}

function withCompressionResult(
	bundle: ContextBundle,
	content: string,
	compressorName: string,
	originalBytes: number,
	outputBytes: number,
): ContextBundle {
	return {
		...bundle,
		content,
		compression: {
			...bundle.compression,
			mode: "lossy-ok",
			result: {
				compressed: true,
				lossy: true,
				provider: compressorName,
				originalBytes,
				outputBytes,
			},
		},
	};
}

export async function compressContextPack(
	pack: ContextPack,
	compressor: ContextCompressor | undefined,
	options: CompressContextPackOptions,
): Promise<{ pack: ContextPack; stats: ContextCompressionStats }> {
	if (!options.enabled) {
		return { pack, stats: EMPTY_CONTEXT_COMPRESSION_STATS };
	}

	const stats: ContextCompressionStats = {
		enabled: true,
		attempted: 0,
		compressed: 0,
		skippedExact: 0,
		failed: 0,
		originalBytes: 0,
		outputBytes: 0,
		fallbackReason: compressor ? undefined : "no-compressor",
	};

	if (!compressor) return { pack, stats };

	const bundles: ContextBundle[] = [];
	for (const bundle of pack.bundles) {
		if (!isLossyOk(bundle)) {
			stats.skippedExact++;
			bundles.push(bundle);
			continue;
		}

		stats.attempted++;
		const originalBytes = byteLength(bundle.content);
		stats.originalBytes += originalBytes;
		try {
			const output = await compressor.compress({ id: bundle.id, content: bundle.content }, options.signal);
			const outputBytes = byteLength(output.content);
			if (output.id !== bundle.id) {
				stats.failed++;
				stats.fallbackReason = "id-mismatch";
				bundles.push(bundle);
				continue;
			}
			if (output.content.trim().length === 0) {
				stats.failed++;
				stats.fallbackReason = "empty-output";
				bundles.push(bundle);
				continue;
			}
			if (outputBytes >= originalBytes) {
				stats.failed++;
				stats.fallbackReason = "not-smaller";
				bundles.push(bundle);
				continue;
			}

			stats.compressed++;
			stats.outputBytes += outputBytes;
			bundles.push(withCompressionResult(bundle, output.content, compressor.name, originalBytes, outputBytes));
		} catch {
			stats.failed++;
			stats.fallbackReason = "compressor-error";
			bundles.push(bundle);
		}
	}

	return { pack: { ...pack, bundles }, stats };
}
