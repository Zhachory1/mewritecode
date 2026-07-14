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

const LOSSY_OK_ENTITY_TYPES = new Set([
	"log",
	"ci-log",
	"test-output",
	"trace-log",
	"tool-json",
	"tool-output",
	"rag-json",
	"rag-output",
	"generated-report",
	"report-snippet",
]);

const EXACT_ENTITY_TYPES = new Set([
	"code",
	"code-chunk",
	"source-code",
	"symbol",
	"diff",
	"patch",
	"config",
	"configuration",
	"citation",
	"provenance",
	"memory",
	"memory-fact",
	"fact",
	"security-log",
	"audit-log",
	"stack-trace",
]);

const CODE_EXTENSIONS = new Set([
	".c",
	".cc",
	".cpp",
	".cs",
	".css",
	".go",
	".h",
	".hpp",
	".java",
	".js",
	".jsx",
	".kt",
	".mjs",
	".php",
	".py",
	".rb",
	".rs",
	".sh",
	".sql",
	".swift",
	".ts",
	".tsx",
]);

const CONFIG_FILE_NAMES = new Set([
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"tsconfig.json",
	"jsconfig.json",
	"biome.json",
	"eslint.config.js",
	"prettier.config.js",
	"vitest.config.ts",
	"vite.config.ts",
	"dockerfile",
]);

function normalizeHint(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function pathExtension(path: string): string {
	const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const fileName = path.slice(lastSlash + 1);
	const dot = fileName.lastIndexOf(".");
	return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function pathBaseName(path: string): string {
	const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return path.slice(lastSlash + 1).toLowerCase();
}

function isConfigPath(path: string): boolean {
	const base = pathBaseName(path);
	return (
		CONFIG_FILE_NAMES.has(base) ||
		base.endsWith(".config.json") ||
		base.endsWith(".config.yaml") ||
		base.endsWith(".config.yml") ||
		base.endsWith("rc") ||
		base.includes(".rc.") ||
		path.endsWith(".toml") ||
		path.endsWith(".ini") ||
		path.endsWith(".env") ||
		path.endsWith(".yaml") ||
		path.endsWith(".yml")
	);
}

function hasExactPreserveHints(bundle: ContextBundle): boolean {
	const entityType = normalizeHint(bundle.entityType);
	const source = normalizeHint(bundle.source);
	const title = normalizeHint(bundle.title);
	const path = normalizeHint(bundle.provenance.path);

	if (EXACT_ENTITY_TYPES.has(entityType)) return true;
	if (bundle.provenance.memoryId) return true;
	if (source.includes("memory") || source === "gbrain" || source === "qmd") return true;
	if (title.includes("citation") || title.includes("provenance")) return true;
	if (title.includes("security") || title.includes("audit")) return true;
	if (path.length === 0) return false;
	if (path.endsWith(".diff") || path.endsWith(".patch")) return true;
	if (path.includes("/diff") || path.includes("/patch")) return true;
	if (isConfigPath(path)) return true;
	return CODE_EXTENSIONS.has(pathExtension(path));
}

function hasLossyOkHints(bundle: ContextBundle): boolean {
	const entityType = normalizeHint(bundle.entityType);
	const source = normalizeHint(bundle.source);
	const title = normalizeHint(bundle.title);
	const path = normalizeHint(bundle.provenance.path);
	const handleType = normalizeHint(bundle.retrievalHandle?.type);

	if (LOSSY_OK_ENTITY_TYPES.has(entityType)) return true;
	if (
		(entityType === "json" || entityType === "metadata-json") &&
		(source.includes("tool") || source.includes("rag"))
	) {
		return true;
	}
	if (
		(entityType === "json" || entityType === "metadata-json") &&
		(handleType.includes("tool") || handleType.includes("rag"))
	) {
		return true;
	}
	if (title.includes("generated report") || title.includes("tool output") || title.includes("rag output")) return true;
	return path.endsWith(".log") || path.endsWith("test-output.txt") || path.endsWith("trace.log");
}

export function routeContextBundleCompression(bundle: ContextBundle): ContextBundle {
	if (bundle.compression?.mode) return bundle;
	if (hasExactPreserveHints(bundle)) return bundle;
	if (!hasLossyOkHints(bundle)) return bundle;
	return {
		...bundle,
		compression: {
			mode: "lossy-ok",
			reason: "context-compression-router",
		},
	};
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
	for (const originalBundle of pack.bundles) {
		const bundle = routeContextBundleCompression(originalBundle);
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
