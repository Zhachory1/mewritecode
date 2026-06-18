/**
 * First-run onboarding wizard (WS11).
 *
 * Four questions max. Designed to clear in ≤5s on the happy path:
 * 1. Theme        — auto-detect bg, offer dark/light/auto.
 * 2. Auth         — detect existing env keys, surface them; otherwise skip.
 * 3. Default model — pick a sensible default given which provider has a key.
 * 4. Telemetry    — explicit opt-in, default OFF.
 *
 * The wizard is small, dependency-light (just node:readline), and idempotent.
 * It writes hasCompletedOnboarding to the global settings file when it
 * finishes (or when the user skips). Re-running with --reset clears the flag.
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { getEnvApiKey } from "@zhachory1/mewrite-ai";
import chalk from "chalk";
import { VERSION } from "../config.js";
import type { SettingsManager } from "../core/settings-manager.js";

/**
 * Providers we surface in the wizard, ordered by user preference.
 * Each maps to a default model id when chosen as the default.
 */
const WIZARD_PROVIDERS: Array<{
	id: string;
	label: string;
	envHint: string;
	defaultModel: string;
}> = [
	{ id: "anthropic", label: "Anthropic (Claude)", envHint: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-5" },
	{ id: "openai", label: "OpenAI (GPT)", envHint: "OPENAI_API_KEY", defaultModel: "gpt-5" },
	{ id: "google", label: "Google (Gemini)", envHint: "GEMINI_API_KEY", defaultModel: "gemini-2.5-pro" },
	{ id: "groq", label: "Groq (fast inference)", envHint: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
	{
		id: "openrouter",
		label: "OpenRouter (gateway)",
		envHint: "OPENROUTER_API_KEY",
		defaultModel: "anthropic/claude-sonnet-4-5",
	},
];

export type ThemeAnswer = "dark" | "light" | "auto";
export type AuthAnswer =
	| { type: "use-env"; provider: string }
	| { type: "configure-later" }
	| { type: "launch-login" }
	| { type: "skip" };

export interface WizardAnswers {
	theme: ThemeAnswer;
	auth: AuthAnswer;
	defaultProvider?: string;
	defaultModel?: string;
	telemetry: boolean;
}

export interface WizardIO {
	stdin: NodeJS.ReadableStream;
	stdout: NodeJS.WritableStream;
	stderr: NodeJS.WritableStream;
	envProbe?: (provider: string) => string | undefined;
	/**
	 * Returns the ids of providers for which a credential is already stored
	 * (e.g. OAuth in auth.json), so an already-authenticated user is not
	 * re-prompted. Injected by the caller (which has AuthStorage); the wizard
	 * itself stays dependency-light.
	 */
	oauthProbe?: () => string[];
	terminalIsDark?: () => boolean | undefined;
	/**
	 * Optional override for prompt input. When provided, the wizard does not
	 * create a readline interface and instead calls this function for every
	 * question. Tests use this to feed a deterministic answer queue.
	 */
	prompt?: (question: string) => Promise<string>;
}

export const DEFAULT_IO: WizardIO = {
	stdin: process.stdin,
	stdout: process.stdout,
	stderr: process.stderr,
	envProbe: (provider: string) => getEnvApiKey(provider),
	terminalIsDark: () => undefined,
};

interface AskCtx {
	rl?: ReadlineInterface;
	out: NodeJS.WritableStream;
	prompt: (question: string) => Promise<string>;
}

function write(out: NodeJS.WritableStream, s: string): void {
	out.write(s);
}

function ask(ctx: AskCtx, prompt: string): Promise<string> {
	return ctx.prompt(prompt);
}

async function askChoice<T>(
	ctx: AskCtx,
	title: string,
	choices: Array<{ key: string; label: string; value: T; default?: boolean }>,
): Promise<T> {
	write(ctx.out, `\n${chalk.bold(title)}\n`);
	for (const c of choices) {
		const marker = c.default ? chalk.green("●") : chalk.dim("○");
		write(ctx.out, `  ${marker} ${chalk.cyan(c.key)}) ${c.label}\n`);
	}
	const def = choices.find((c) => c.default);
	const hint = def ? chalk.dim(`[default: ${def.key}]`) : "";
	while (true) {
		const a = (await ask(ctx, `> ${hint} `)).toLowerCase();
		if (a === "" && def) return def.value;
		const match = choices.find((c) => c.key.toLowerCase() === a);
		if (match) return match.value;
		write(ctx.out, chalk.yellow(`  Please answer with one of: ${choices.map((c) => c.key).join(", ")}\n`));
	}
}

async function askYesNo(ctx: AskCtx, title: string, def: boolean): Promise<boolean> {
	const choices = def
		? [
				{ key: "Y", label: "yes", value: true, default: true },
				{ key: "n", label: "no", value: false },
			]
		: [
				{ key: "y", label: "yes", value: true },
				{ key: "N", label: "no", value: false, default: true },
			];
	return askChoice(ctx, title, choices);
}

/**
 * Detect which providers we already have credentials for: env-var API keys AND
 * stored OAuth credentials (via the injected {@link WizardIO.oauthProbe}). An
 * already-OAuth'd user is reported as configured so the wizard doesn't re-prompt.
 */
export function detectAvailableEnvProviders(io: WizardIO = DEFAULT_IO): Array<{ id: string; envHint: string }> {
	const probe = io.envProbe ?? DEFAULT_IO.envProbe!;
	const found: Array<{ id: string; envHint: string }> = [];
	const seen = new Set<string>();
	for (const p of WIZARD_PROVIDERS) {
		const key = probe(p.id);
		if (key && key.length > 0) {
			found.push({ id: p.id, envHint: p.envHint });
			seen.add(p.id);
		}
	}
	for (const id of io.oauthProbe?.() ?? []) {
		if (seen.has(id)) continue;
		seen.add(id);
		const wp = WIZARD_PROVIDERS.find((p) => p.id === id);
		found.push({ id, envHint: wp?.envHint ?? "stored OAuth credentials" });
	}
	return found;
}

/**
 * Decide whether the wizard should run. It runs when:
 *   - the user has not completed it before, AND
 *   - we are attached to a TTY (so prompts make sense), AND
 *   - the caller did not explicitly skip via env or settings.
 */
export function shouldRunOnboarding(settings: SettingsManager, io: WizardIO = DEFAULT_IO): boolean {
	if (process.env.CAVE_SKIP_ONBOARDING === "1") return false;
	if (settings.getHasCompletedOnboarding()) return false;
	const stdin = io.stdin as NodeJS.ReadStream;
	if (stdin && stdin.isTTY === false) return false;
	return true;
}

/**
 * Compose the wizard. Pure-ish: reads io, returns the chosen answers, and
 * persists them via the provided SettingsManager. No network. No model loads.
 */
export async function runOnboarding(settings: SettingsManager, io: WizardIO = DEFAULT_IO): Promise<WizardAnswers> {
	const out = io.stdout;
	const rl = io.prompt ? undefined : createInterface({ input: io.stdin, output: io.stdout });
	const promptFn =
		io.prompt ??
		((q: string) =>
			new Promise<string>((resolve) => {
				rl!.question(q, (a) => resolve(a.trim()));
			}));
	const ctx: AskCtx = { rl, out, prompt: promptFn };

	try {
		write(out, chalk.bold.cyan("\n  Welcome to cave\n"));
		write(out, chalk.dim("  Four quick questions. You can change anything later via /config.\n"));

		// 1. Theme — auto-detect background.
		const detectedDark = io.terminalIsDark?.();
		const themeChoices: Array<{ key: string; label: string; value: ThemeAnswer; default?: boolean }> = [
			{ key: "1", label: "auto-detect (recommended)", value: "auto", default: true },
			{ key: "2", label: "dark", value: "dark" },
			{ key: "3", label: "light", value: "light" },
		];
		const detectedHint =
			detectedDark === true ? " (detected dark)" : detectedDark === false ? " (detected light)" : "";
		const theme: ThemeAnswer = await askChoice(ctx, `1) Theme${detectedHint}`, themeChoices);

		// 2. Auth — detect env keys, offer to use them.
		const envProviders = detectAvailableEnvProviders(io);
		let auth: AuthAnswer;
		let chosenProvider: string | undefined;
		if (envProviders.length > 0) {
			const choices: Array<{ key: string; label: string; value: AuthAnswer; default?: boolean }> = envProviders.map(
				(p, i) => ({
					key: String(i + 1),
					label: `use ${WIZARD_PROVIDERS.find((wp) => wp.id === p.id)?.label ?? p.id} (found ${p.envHint})`,
					value: { type: "use-env", provider: p.id } as AuthAnswer,
					default: i === 0,
				}),
			);
			choices.push({
				key: "s",
				label: "skip — I'll configure auth later",
				value: { type: "configure-later" } as AuthAnswer,
			});
			auth = await askChoice(ctx, "2) Authentication (detected existing API keys)", choices);
		} else {
			write(out, chalk.bold("\n2) Authentication\n"));
			write(out, chalk.dim("  No API keys found in the environment.\n"));
			write(out, chalk.dim("  Cave can log you in via OAuth now (no API key needed), or you can\n"));
			write(out, chalk.dim("  set ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY (etc) and re-run.\n"));
			const configureNow = await askYesNo(ctx, "Configure auth now?", true);
			if (configureNow) {
				auth = { type: "launch-login" };
			} else {
				write(out, chalk.yellow("  You'll need to log in (via /login) before your first prompt.\n"));
				auth = { type: "skip" };
			}
		}
		if (auth.type === "use-env") {
			chosenProvider = auth.provider;
		}

		// 3. Default model — only ask if we picked a provider.
		let defaultProvider: string | undefined;
		let defaultModel: string | undefined;
		if (chosenProvider) {
			const provider = WIZARD_PROVIDERS.find((p) => p.id === chosenProvider);
			if (provider) {
				const choices = [
					{
						key: "1",
						label: `${provider.defaultModel} (recommended default)`,
						value: provider.defaultModel,
						default: true,
					},
					{ key: "2", label: "skip — pick later via /model", value: "" },
				];
				const picked = await askChoice(ctx, `3) Default model for ${provider.label}`, choices);
				if (picked) {
					defaultProvider = provider.id;
					defaultModel = picked;
				}
			}
		} else {
			write(out, chalk.dim("\n3) Default model — skipped (no provider chosen).\n"));
		}

		// 4. Telemetry — default OFF (WS11 mandate).
		write(out, chalk.bold("\n4) Telemetry\n"));
		write(out, chalk.dim("  Cave does NOT send telemetry by default. Opt-in only. You can change this later.\n"));
		const telemetry = await askYesNo(ctx, "Enable anonymous usage telemetry?", false);

		const answers: WizardAnswers = {
			theme,
			auth,
			defaultProvider,
			defaultModel,
			telemetry,
		};

		persistAnswers(settings, answers);

		write(out, "\n");
		write(out, chalk.green("  All set. Press Enter to continue to the prompt.\n"));
		write(
			out,
			chalk.dim(
				`  Saved to ${settings.constructor.name === "SettingsManager" ? "~/.cave/agent/settings.json" : "settings"}.\n`,
			),
		);

		return answers;
	} finally {
		rl?.close();
	}
}

export function persistAnswers(settings: SettingsManager, a: WizardAnswers): void {
	if (a.theme === "dark") {
		settings.setTheme("default-dark");
	} else if (a.theme === "light") {
		settings.setTheme("default-light");
	}
	// "auto" leaves theme unset and lets the runtime probe pick.

	if (a.defaultProvider && a.defaultModel) {
		settings.setDefaultModelAndProvider(a.defaultProvider, a.defaultModel);
	}

	settings.setTelemetryEnabled(a.telemetry);
	settings.markOnboardingCompleted(VERSION);
}
