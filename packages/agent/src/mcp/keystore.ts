// keystore.ts — token cache for MCP OAuth bearer tokens.
//
// Today: file-based store at `~/.cave/mcp-tokens.json` with mode 0600.
// TODO(ws2-keytar): swap in `keytar` for OS keychain (Keychain on macOS,
// libsecret on Linux, Credential Vault on Windows). Keytar requires native
// compilation, which complicates the bun-built binary; the file store is the
// safe interim and exposes the same `KeyStore` interface so the swap is a
// 5-line patch in `caveman mcp login`.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface OAuthTokens {
	accessToken: string;
	refreshToken?: string;
	tokenType?: string;
	expiresAt?: number; // ms epoch
	scope?: string;
}

export interface KeyStore {
	get(serverName: string): Promise<OAuthTokens | undefined>;
	set(serverName: string, tokens: OAuthTokens): Promise<void>;
	delete(serverName: string): Promise<void>;
	list(): Promise<string[]>;
}

const SERVICE = "cave.mcp";

function defaultStorePath(): string {
	return join(homedir(), ".cave", "mcp-tokens.json");
}

interface StoredFile {
	service: string;
	tokens: Record<string, OAuthTokens>;
}

export class FileKeyStore implements KeyStore {
	constructor(private readonly path: string = defaultStorePath()) {}

	private read(): StoredFile {
		if (!existsSync(this.path)) {
			return { service: SERVICE, tokens: {} };
		}
		try {
			const raw = readFileSync(this.path, "utf8");
			const parsed = JSON.parse(raw) as Partial<StoredFile>;
			return {
				service: parsed.service ?? SERVICE,
				tokens: parsed.tokens ?? {},
			};
		} catch {
			return { service: SERVICE, tokens: {} };
		}
	}

	private write(data: StoredFile): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
		try {
			chmodSync(this.path, 0o600);
		} catch {
			// best-effort on non-POSIX
		}
	}

	async get(serverName: string): Promise<OAuthTokens | undefined> {
		const data = this.read();
		return data.tokens[serverName];
	}

	async set(serverName: string, tokens: OAuthTokens): Promise<void> {
		const data = this.read();
		data.tokens[serverName] = tokens;
		this.write(data);
	}

	async delete(serverName: string): Promise<void> {
		const data = this.read();
		delete data.tokens[serverName];
		this.write(data);
	}

	async list(): Promise<string[]> {
		const data = this.read();
		return Object.keys(data.tokens);
	}
}

let _default: KeyStore | undefined;
export function getDefaultKeyStore(): KeyStore {
	if (!_default) _default = new FileKeyStore();
	return _default;
}

/** For tests. */
export function setDefaultKeyStore(store: KeyStore): void {
	_default = store;
}
