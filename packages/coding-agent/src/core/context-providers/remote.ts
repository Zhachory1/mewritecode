import { basename } from "node:path";
import type { ContextBundle, ContextEngine, ContextHealth, ContextPack, ContextQuery } from "../context-engine.js";

export type RemoteContextState =
	| "disabled"
	| "missing-endpoint"
	| "missing-token"
	| "invalid-endpoint"
	| "insecure-endpoint"
	| "request-too-large"
	| "timeout"
	| "auth-failed"
	| "rate-limited"
	| "remote-unavailable"
	| "schema-mismatch"
	| "oversize-response"
	| "circuit-open"
	| "adapter-error";

export class RemoteContextError extends Error {
	constructor(
		readonly state: RemoteContextState,
		message: string,
	) {
		super(message);
		this.name = "RemoteContextError";
	}
}

export interface RemoteContextRequestedScope {
	org?: string;
	team?: string;
	project?: string;
	user?: string;
}

export interface RemoteContextEngineOptions {
	cwd: string;
	endpoint?: string;
	tokenEnv?: string;
	requestedScope?: RemoteContextRequestedScope;
	allowInsecureLocalhost?: boolean;
	maxRequestBytes?: number;
	maxResponseBytes?: number;
	maxBundleBytes?: number;
	maxBundles?: number;
	failureThreshold?: number;
	failureTtlMs?: number;
	fetchImpl?: typeof fetch;
	now?: () => number;
}

interface RemoteContextQueryRequest {
	protocolVersion: 1;
	query: {
		text: string;
		redacted: boolean;
		cwdBasename: string;
		explicitRefs: string[];
	};
	requestedScope: RemoteContextRequestedScope;
	budget: {
		maxBundles: number;
		maxChars: number;
		timeoutMs: number;
	};
	client: {
		name: "mewrite-code";
		version: "m10a";
	};
}

interface RemoteContextResponseBundle {
	id: string;
	source: string;
	entity: string;
	title?: string;
	content: string;
	score?: number;
	provenance: {
		provider: string;
		scope?: string;
		uri?: string;
		path?: string;
		lineStart?: number;
		lineEnd?: number;
		commit?: string;
	};
}

interface RemoteContextQueryResponse {
	protocolVersion: 1;
	requestId: string;
	pack: {
		bundles: RemoteContextResponseBundle[];
	};
}

const DEFAULT_TOKEN_ENV = "MEWRITE_CONTEXT_REMOTE_TOKEN";
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_BUNDLE_BYTES = 16 * 1024;
const DEFAULT_MAX_BUNDLES = 12;
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_FAILURE_TTL_MS = 30_000;

const SOURCE_PATH_RE =
	/(?<![\w/])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cc|cpp|rb|php|md|json|yaml|yml))(?![\w])/g;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
	return { text: Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function redactSecrets(text: string): { text: string; redacted: boolean } {
	let redacted = false;
	let out = text.replace(/```[\s\S]*?```/g, () => {
		redacted = true;
		return "[redacted code block]";
	});
	out = out.replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, () => {
		redacted = true;
		return "Authorization: Bearer [redacted]";
	});
	out = out.replace(/\bBearer\s+[^\s,;]+/gi, () => {
		redacted = true;
		return "Bearer [redacted]";
	});
	out = out.replace(/\bAuthorization\s*:\s*Basic\s+[^\s,;]+/gi, () => {
		redacted = true;
		return "Authorization: Basic [redacted]";
	});
	out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => {
		redacted = true;
		return "[redacted private key]";
	});
	out = out.replace(
		/\b(api[_-]?key|token|secret|password|session[_-]?token)\b\s*[:=]\s*([^\s,;]+)/gi,
		(_match, key) => {
			redacted = true;
			return `${key}=[redacted]`;
		},
	);
	out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, () => {
		redacted = true;
		return "[redacted-openai-key]";
	});
	out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, () => {
		redacted = true;
		return "[redacted-github-token]";
	});
	out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, () => {
		redacted = true;
		return "[redacted-aws-key]";
	});
	return { text: out, redacted };
}

export function buildRemoteContextQueryText(rawPrompt: string, maxBytes: number): { text: string; redacted: boolean } {
	const redacted = redactSecrets(rawPrompt);
	const lines = redacted.text
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => (line.length > 300 ? `${line.slice(0, 300)} …` : line));
	const normalized = lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	const clipped = utf8Truncate(normalized, Math.max(256, maxBytes));
	return { text: clipped.text, redacted: redacted.redacted || clipped.truncated };
}

export function extractExplicitRefs(text: string): string[] {
	const refs = new Set<string>();
	for (const match of text.matchAll(SOURCE_PATH_RE)) refs.add(match[1]);
	return [...refs].slice(0, 20);
}

function endpointUrl(endpoint: string | undefined, allowInsecureLocalhost: boolean): URL {
	if (!endpoint) throw new RemoteContextError("missing-endpoint", "remote context endpoint is not configured");
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new RemoteContextError("invalid-endpoint", "remote context endpoint is not a valid URL");
	}
	if (url.protocol !== "https:") {
		const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
		if (!local || !allowInsecureLocalhost) {
			throw new RemoteContextError("insecure-endpoint", "remote context endpoint must use HTTPS");
		}
	}
	return url;
}

export function remoteEndpointHost(endpoint: string | undefined): string {
	if (!endpoint) return "<unset>";
	try {
		const url = new URL(endpoint);
		return `${url.protocol}//${url.host}`;
	} catch {
		return "<invalid>";
	}
}

function validateResponseBundle(value: unknown): RemoteContextResponseBundle | undefined {
	if (!isObject(value)) return undefined;
	if (typeof value.id !== "string") return undefined;
	if (typeof value.source !== "string") return undefined;
	if (typeof value.entity !== "string") return undefined;
	if (typeof value.content !== "string") return undefined;
	if (!isObject(value.provenance) || typeof value.provenance.provider !== "string") return undefined;
	if (value.score !== undefined && typeof value.score !== "number") return undefined;
	return value as unknown as RemoteContextResponseBundle;
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
	const contentLength = response.headers.get("content-length");
	if (contentLength !== null && Number(contentLength) > maxBytes) {
		throw new RemoteContextError("oversize-response", "remote context response exceeded maxResponseBytes");
	}
	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > maxBytes) {
			throw new RemoteContextError("oversize-response", "remote context response exceeded maxResponseBytes");
		}
		return text;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new RemoteContextError("oversize-response", "remote context response exceeded maxResponseBytes");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString("utf8");
}

function safeRequestId(id: string): string {
	return /^[A-Za-z0-9._:-]{1,80}$/.test(id) ? id : "<redacted>";
}

function validateResponse(value: unknown): RemoteContextQueryResponse {
	if (!isObject(value)) throw new RemoteContextError("schema-mismatch", "remote response is not an object");
	if (value.protocolVersion !== 1) throw new RemoteContextError("schema-mismatch", "remote protocolVersion must be 1");
	if (typeof value.requestId !== "string")
		throw new RemoteContextError("schema-mismatch", "remote requestId is required");
	if (!isObject(value.pack) || !Array.isArray(value.pack.bundles)) {
		throw new RemoteContextError("schema-mismatch", "remote pack.bundles must be an array");
	}
	return value as unknown as RemoteContextQueryResponse;
}

function mapBundle(bundle: RemoteContextResponseBundle, maxBundleBytes: number): ContextBundle {
	const clipped = utf8Truncate(bundle.content, maxBundleBytes);
	const provider = bundle.provenance.provider.replace(/[^a-zA-Z0-9_.-]+/g, "-") || "unknown";
	const remoteReference = bundle.provenance.path ?? bundle.provenance.uri;
	return {
		id: `remote:${provider}:${bundle.id}`,
		source: `remote:${provider}`,
		entityType: bundle.entity,
		title: bundle.title ?? bundle.id,
		content: clipped.text,
		score: bundle.score,
		tokenEstimate: Math.ceil(Buffer.byteLength(clipped.text, "utf8") / 4) + 80,
		provenance: {
			url: remoteReference
				? `remote://${provider}/${remoteReference.replace(/^\w+:\/\//, "").replace(/^\/+/, "")}`
				: undefined,
			startLine: bundle.provenance.lineStart,
			endLine: bundle.provenance.lineEnd,
		},
	};
}

export class RemoteContextEngine implements ContextEngine {
	readonly name = "remote";
	private readonly fetchImpl: typeof fetch;
	private readonly now: () => number;
	private failures = 0;
	private skipUntil = 0;

	constructor(private readonly options: RemoteContextEngineOptions) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.now = options.now ?? (() => Date.now());
	}

	async health(): Promise<ContextHealth> {
		try {
			endpointUrl(this.options.endpoint, this.options.allowInsecureLocalhost ?? true);
			const tokenEnv = this.options.tokenEnv ?? DEFAULT_TOKEN_ENV;
			if (!process.env[tokenEnv])
				return { enabled: true, provider: "remote", ok: false, detail: `missing token env ${tokenEnv}` };
			return {
				enabled: true,
				provider: "remote",
				ok: true,
				detail: `endpoint=${remoteEndpointHost(this.options.endpoint)}`,
			};
		} catch (error) {
			return {
				enabled: true,
				provider: "remote",
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async retrieve(query: ContextQuery): Promise<ContextPack> {
		const now = this.now();
		if (this.skipUntil > now) {
			throw new RemoteContextError(
				"circuit-open",
				`remote context skipped until ${new Date(this.skipUntil).toISOString()}`,
			);
		}

		const url = endpointUrl(this.options.endpoint, this.options.allowInsecureLocalhost ?? true);
		const tokenEnv = this.options.tokenEnv ?? DEFAULT_TOKEN_ENV;
		const token = process.env[tokenEnv];
		if (!token) throw new RemoteContextError("missing-token", `missing token env ${tokenEnv}`);

		url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/context/query`;
		const maxRequestBytes = this.options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
		const maxResponseBytes = this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		const maxBundleBytes = this.options.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
		const maxBundles = Math.max(1, this.options.maxBundles ?? DEFAULT_MAX_BUNDLES);
		const queryText = buildRemoteContextQueryText(query.rawUserPrompt, Math.floor(maxRequestBytes / 4));
		const request: RemoteContextQueryRequest = {
			protocolVersion: 1,
			query: {
				text: queryText.text,
				redacted: queryText.redacted,
				cwdBasename: basename(query.cwd),
				explicitRefs: extractExplicitRefs(queryText.text),
			},
			requestedScope: this.options.requestedScope ?? {},
			budget: {
				maxBundles,
				maxChars: maxBundleBytes * maxBundles,
				timeoutMs: query.timeoutMs ?? 1000,
			},
			client: { name: "mewrite-code", version: "m10a" },
		};

		const body = JSON.stringify(request);
		if (Buffer.byteLength(body, "utf8") > maxRequestBytes) {
			throw new RemoteContextError("request-too-large", "remote context request exceeded maxRequestBytes");
		}

		let abortRecorded = false;
		const onAbort = () => {
			if (query.signal?.reason !== "timeout") return;
			abortRecorded = true;
			this.recordFailure(new RemoteContextError("timeout", "remote context request aborted"));
		};
		query.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body,
				signal: query.signal,
			});
			if (response.status === 401 || response.status === 403)
				throw new RemoteContextError("auth-failed", `remote context auth failed (${response.status})`);
			if (response.status === 429)
				throw new RemoteContextError("rate-limited", "remote context endpoint rate limited request");
			if (!response.ok)
				throw new RemoteContextError("remote-unavailable", `remote context endpoint returned ${response.status}`);
			const text = await readResponseText(response, maxResponseBytes);
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				throw new RemoteContextError("schema-mismatch", "remote context response was not JSON");
			}
			const valid = validateResponse(parsed);
			const bundles = valid.pack.bundles.slice(0, maxBundles).map((value) => {
				const bundle = validateResponseBundle(value);
				if (!bundle) throw new RemoteContextError("schema-mismatch", "remote context bundle is malformed");
				return mapBundle(bundle, maxBundleBytes);
			});
			this.failures = 0;
			this.skipUntil = 0;
			return {
				bundles,
				sources: {
					remote: {
						ok: true,
						detail: `endpoint=${remoteEndpointHost(this.options.endpoint)} requestId=${safeRequestId(valid.requestId)} bundles=${bundles.length}`,
					},
				},
			};
		} catch (error) {
			if (query.signal?.aborted) {
				const wrapped = new RemoteContextError(
					query.signal.reason === "timeout" ? "timeout" : "adapter-error",
					"remote context request aborted",
				);
				if (query.signal.reason === "timeout" && !abortRecorded) this.recordFailure(wrapped);
				throw wrapped;
			}
			this.recordFailure(error);
			throw error;
		} finally {
			query.signal?.removeEventListener("abort", onAbort);
		}
	}

	private recordFailure(error: unknown): void {
		if (
			error instanceof RemoteContextError &&
			["missing-token", "missing-endpoint", "invalid-endpoint", "insecure-endpoint"].includes(error.state)
		) {
			return;
		}
		this.failures++;
		const threshold = Math.max(1, this.options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
		if (this.failures >= threshold) {
			this.skipUntil = this.now() + Math.max(1, this.options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS);
		}
	}
}
