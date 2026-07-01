import { createHash } from "node:crypto";
import { homedir } from "node:os";

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|credential|private[_-]?key)/i;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/-]+=*/gi;
const GENERIC_SECRET_PATTERN = /(?:sk|pk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|ya29|AIza)[a-z0-9_-]{12,}/gi;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+):([^\s/@]+)@/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export interface RedactionConfig {
	additionalSecretKeys?: string[];
	additionalPatterns?: string[];
}

export interface RedactionResult<T> {
	value: T;
	counts: Record<string, number>;
}

function increment(counts: Record<string, number>, key: string, amount: number): void {
	if (amount <= 0) return;
	counts[key] = (counts[key] ?? 0) + amount;
}

function replaceAndCount(
	text: string,
	pattern: RegExp,
	replacement: string,
	counts: Record<string, number>,
	key: string,
): string {
	let count = 0;
	const next = text.replace(pattern, () => {
		count++;
		return replacement;
	});
	increment(counts, key, count);
	return next;
}

function normalizeHomePath(text: string, counts: Record<string, number>): string {
	const home = homedir();
	if (!home || !text.includes(home)) return text;
	increment(counts, "homePath", 1);
	return text.split(home).join("~");
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function redactString(text: string, config: RedactionConfig, counts: Record<string, number>): string {
	let value = normalizeHomePath(text, counts);
	value = replaceAndCount(value, BEARER_PATTERN, "Bearer [REDACTED]", counts, "bearerToken");
	value = replaceAndCount(value, GENERIC_SECRET_PATTERN, "[REDACTED_SECRET]", counts, "secretPattern");
	value = replaceAndCount(value, URL_CREDENTIAL_PATTERN, "$1[REDACTED]@", counts, "urlCredential");
	value = replaceAndCount(value, EMAIL_PATTERN, "[REDACTED_EMAIL]", counts, "email");
	for (const pattern of config.additionalPatterns ?? []) {
		try {
			value = replaceAndCount(value, new RegExp(pattern, "gi"), "[REDACTED_CUSTOM]", counts, "customPattern");
		} catch {
			increment(counts, "invalidCustomPattern", 1);
		}
	}
	return value;
}

function isSecretKey(key: string, config: RedactionConfig): boolean {
	if (SECRET_KEY_PATTERN.test(key)) return true;
	return (config.additionalSecretKeys ?? []).some((secretKey) => secretKey.toLowerCase() === key.toLowerCase());
}

function redactUnknown(value: unknown, config: RedactionConfig, counts: Record<string, number>, keyPath = ""): unknown {
	if (typeof value === "string") {
		return redactString(value, config, counts);
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item, index) => redactUnknown(item, config, counts, `${keyPath}.${index}`));
	}
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			if (isSecretKey(key, config)) {
				out[key] = `[REDACTED:${hashText(`${keyPath}.${key}`)}]`;
				increment(counts, "secretKey", 1);
				continue;
			}
			out[key] = redactUnknown(child, config, counts, `${keyPath}.${key}`);
		}
		return out;
	}
	return undefined;
}

export function redactForDiagnostics<T>(value: T, config: RedactionConfig = {}): RedactionResult<T> {
	const counts: Record<string, number> = {};
	return { value: redactUnknown(value, config, counts) as T, counts };
}

export function hasSensitiveKey(key: string, config: RedactionConfig = {}): boolean {
	return isSecretKey(key, config);
}
