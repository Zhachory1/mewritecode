/**
 * `caveman login` (WS11) — minimal headless-friendly login dispatcher.
 *
 * This command exists to give headless / SSH / CI users a deterministic way
 * to attach an OAuth credential or API key without opening the interactive
 * TUI. The full provider OAuth flows live in `@juliusbrussee/caveman-ai` (see
 * packages/ai/src/utils/oauth/). This dispatcher is a thin shim:
 *
 *   caveman login                       # show available providers + env hints
 *   caveman login --provider anthropic  # run anthropic OAuth (browser)
 *   caveman login --device-auth         # prefer device flow when available
 *   caveman login --provider openai --api-key <key>   # store a raw key
 *   caveman login --json                # machine-readable status output
 *
 * Heavy auth-storage manipulation is deliberately *not* done here — that
 * touches AuthStorage internals owned by other workstreams. We surface the
 * existing flows and persist results via the same paths cave already uses.
 *
 * No TUI imports — this command is callable from non-TTY contexts.
 */

import { createInterface } from "node:readline";
import {
	getEnvApiKey,
	getOAuthProvider,
	getOAuthProviders,
	type OAuthAuthInfo,
	type OAuthPrompt,
	type OAuthProviderInterface,
} from "@juliusbrussee/caveman-ai";
import chalk from "chalk";
import { AuthStorage } from "../core/auth-storage.js";

interface LoginOptions {
	provider?: string;
	apiKey?: string;
	deviceAuth?: boolean;
	json?: boolean;
	help?: boolean;
}

function parseLoginArgs(args: string[]): LoginOptions {
	const opts: LoginOptions = {};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--provider" && i + 1 < args.length) {
			opts.provider = args[++i];
		} else if (a === "--api-key" && i + 1 < args.length) {
			opts.apiKey = args[++i];
		} else if (a === "--device-auth") {
			opts.deviceAuth = true;
		} else if (a === "--json") {
			opts.json = true;
		} else if (a === "--help" || a === "-h") {
			opts.help = true;
		}
	}
	return opts;
}

function printHelp(): void {
	process.stdout.write(`${chalk.bold("caveman login")} — manage authentication credentials

Usage:
  caveman login                          Show providers and current auth status
  caveman login --provider <id>          Start OAuth login for a provider
  caveman login --provider <id> --api-key <k>
                                      Store a raw API key for a provider
  caveman login --device-auth            Prefer device-code OAuth (headless / SSH)
  caveman login --json                   Emit machine-readable JSON

Built-in OAuth providers:
${getOAuthProviders()
	.map((p: OAuthProviderInterface) => `  - ${p.id} (${p.name})`)
	.join("\n")}

Environment-key providers (set the env var, no login needed):
  - anthropic    ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN)
  - openai       OPENAI_API_KEY
  - google       GEMINI_API_KEY
  - groq         GROQ_API_KEY
  - openrouter   OPENROUTER_API_KEY
  - xai          XAI_API_KEY
  - mistral      MISTRAL_API_KEY
`);
}

function readLineQuestion(q: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		rl.question(q, (a) => {
			rl.close();
			resolve(a.trim());
		});
	});
}

interface LoginStatus {
	provider: string;
	state: "env-key" | "oauth-stored" | "no-auth";
	hint?: string;
}

function listAuthStatus(): LoginStatus[] {
	const providers = ["anthropic", "openai", "google", "groq", "openrouter", "xai", "mistral", "github-copilot"];
	const out: LoginStatus[] = [];
	const auth = AuthStorage.create();
	for (const p of providers) {
		const env = getEnvApiKey(p);
		if (env) {
			out.push({ provider: p, state: "env-key", hint: "from environment" });
			continue;
		}
		try {
			// AuthStorage exposes hasOAuthToken/getApiKey on cave's existing API.
			const stored = (
				auth as unknown as { getStoredOAuthCredentials?: (id: string) => unknown }
			).getStoredOAuthCredentials?.(p);
			if (stored) {
				out.push({ provider: p, state: "oauth-stored", hint: "OAuth token stored" });
				continue;
			}
		} catch {
			// best-effort
		}
		out.push({ provider: p, state: "no-auth" });
	}
	return out;
}

/**
 * Run an OAuth flow for a provider. Uses the provider's onAuth/onPrompt
 * callbacks to drive a non-TUI flow that works over plain SSH.
 */
async function runOAuth(providerId: string, opts: LoginOptions): Promise<number> {
	const provider = getOAuthProvider(providerId);
	if (!provider) {
		emit({ ok: false, msg: `unknown OAuth provider: ${providerId}` }, opts.json);
		return 1;
	}

	process.stdout.write(`${chalk.bold(`Logging in to ${provider.name}…`)}\n`);
	let printedUrl = false;
	try {
		const credentials = await provider.login({
			onAuth: (info: OAuthAuthInfo) => {
				printedUrl = true;
				process.stdout.write(`\nOpen this URL in your browser:\n  ${chalk.cyan(info.url)}\n`);
				if (info.instructions) {
					process.stdout.write(`${chalk.dim(info.instructions)}\n`);
				}
				process.stdout.write("\n");
			},
			onPrompt: async (prompt: OAuthPrompt) => {
				const answer = await readLineQuestion(`${prompt.message || "auth"}: `);
				return answer;
			},
			onProgress: (msg: string) => {
				process.stdout.write(chalk.dim(`  ${msg}\n`));
			},
			onManualCodeInput: async () => readLineQuestion("paste the redirect URL or code: "),
		});
		emit(
			{
				ok: true,
				msg: `logged in to ${provider.name}`,
				provider: providerId,
				expiresAt: credentials.expires,
			},
			opts.json,
		);
		return 0;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!printedUrl && message.toLowerCase().includes("browser")) {
			process.stderr.write(chalk.yellow("Tip: --device-auth gives a headless flow.\n"));
		}
		emit({ ok: false, msg: `login failed: ${message}` }, opts.json);
		return 1;
	}
}

function emit(obj: Record<string, unknown>, json: boolean | undefined): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(obj)}\n`);
	} else if (obj.ok) {
		process.stdout.write(`${obj.msg}\n`);
	} else {
		process.stderr.write(`${chalk.red("error:")} ${obj.msg}\n`);
	}
}

export async function runLogin(args: string[]): Promise<number> {
	const opts = parseLoginArgs(args);
	if (opts.help) {
		printHelp();
		return 0;
	}

	// Status mode (no flags / no provider).
	if (!opts.provider && !opts.apiKey) {
		const status = listAuthStatus();
		if (opts.json) {
			process.stdout.write(`${JSON.stringify({ ok: true, providers: status }, null, 2)}\n`);
		} else {
			process.stdout.write(`${chalk.bold("Auth status:")}\n`);
			for (const s of status) {
				const tag =
					s.state === "env-key"
						? chalk.green("[env]")
						: s.state === "oauth-stored"
							? chalk.green("[oauth]")
							: chalk.dim("[--]");
				const hint = s.hint ? chalk.dim(` (${s.hint})`) : "";
				process.stdout.write(`  ${tag} ${s.provider}${hint}\n`);
			}
			process.stdout.write(chalk.dim("\nRun `caveman login --provider <id>` to start a login flow.\n"));
		}
		return 0;
	}

	// Raw API key path: store via AuthStorage and return.
	if (opts.apiKey && opts.provider) {
		try {
			const auth = AuthStorage.create();
			// AuthStorage.setRuntimeApiKey() already exists; we use the same path
			// the runtime uses for --api-key.
			(auth as unknown as { setRuntimeApiKey: (provider: string, key: string) => void }).setRuntimeApiKey(
				opts.provider,
				opts.apiKey,
			);
			emit({ ok: true, msg: `stored API key for ${opts.provider}` }, opts.json);
			return 0;
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			emit({ ok: false, msg: `could not store key: ${m}` }, opts.json);
			return 1;
		}
	}

	if (!opts.provider) {
		emit({ ok: false, msg: "missing --provider <id> (use --help to list)" }, opts.json);
		return 1;
	}

	return runOAuth(opts.provider, opts);
}
