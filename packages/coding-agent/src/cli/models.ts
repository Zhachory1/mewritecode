/**
 * WS15: `caveman models` subcommand handler.
 *
 * Subcommands:
 *   caveman models update [--channel stable|beta]  — fetch registry and write cache
 *   caveman models list [--provider <id>]           — list providers/models
 *   caveman models inspect <id>                     — show model details
 */

import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import {
	type FetchChannel,
	fetchAndCacheRegistry,
	getCachePath,
	loadRegistry,
	type Registry,
} from "../../../ai/src/registry/index.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getAgentConfigDir(): string {
	const envDir = process.env.CAVE_CODING_AGENT_DIR;
	if (envDir) return envDir;
	return join(homedir(), ".cave", "agent");
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function runModelsUpdate(argv: string[]): Promise<number> {
	let channel: FetchChannel = "stable";

	for (let i = 0; i < argv.length; i++) {
		if ((argv[i] === "--channel" || argv[i] === "-c") && i + 1 < argv.length) {
			const ch = argv[++i];
			if (ch === "stable" || ch === "beta") {
				channel = ch;
			} else {
				console.error(chalk.red(`Unknown channel "${ch}". Use stable or beta.`));
				return 1;
			}
		}
	}

	const configDir = getAgentConfigDir();
	const cachePath = getCachePath(configDir);

	console.log(chalk.dim(`Fetching registry (channel: ${channel})...`));

	const result = await fetchAndCacheRegistry(cachePath, channel);
	if (!result.ok) {
		console.error(chalk.red(`Error: ${result.error}`));
		return 1;
	}

	const providerCount = result.registry.providers.length;
	const modelCount = result.registry.providers.reduce((sum, p) => sum + p.models.length, 0);

	console.log(
		chalk.green(`Registry updated to v${result.registry.version} — ${providerCount} providers, ${modelCount} models`),
	);
	console.log(chalk.dim(`Cached at: ${cachePath}`));
	return 0;
}

function printRegistry(registry: Registry, filterProvider?: string): void {
	const providers = filterProvider
		? registry.providers.filter(
				(p) => p.id === filterProvider || p.name.toLowerCase() === filterProvider.toLowerCase(),
			)
		: registry.providers;

	if (providers.length === 0) {
		if (filterProvider) {
			console.log(`No provider matching "${filterProvider}"`);
		} else {
			console.log("Registry is empty.");
		}
		return;
	}

	for (const provider of providers) {
		console.log(
			`\n${chalk.bold(provider.name)} ${chalk.dim(`(${provider.id})`)} ${chalk.dim(`[${provider.kind}]`)} auth:${provider.auth}`,
		);

		if (provider.models.length === 0) {
			console.log(chalk.dim("  (no models)"));
			continue;
		}

		// Column widths
		const idWidth = Math.max(8, ...provider.models.map((m) => m.id.length));
		const nameWidth = Math.max(4, ...provider.models.map((m) => m.displayName.length));

		const header = [
			`  ${"model-id".padEnd(idWidth)}`,
			"name".padEnd(nameWidth),
			"context",
			"in$/Mtok",
			"out$/Mtok",
			"caps",
		].join("  ");
		console.log(chalk.dim(header));

		for (const model of provider.models) {
			const ctx =
				model.contextWindow >= 1_000_000
					? `${(model.contextWindow / 1_000_000).toFixed(1)}M`
					: model.contextWindow >= 1_000
						? `${Math.round(model.contextWindow / 1_000)}K`
						: String(model.contextWindow);

			const inCost = model.inputCostPerMtok !== undefined ? `$${model.inputCostPerMtok}` : "—";
			const outCost = model.outputCostPerMtok !== undefined ? `$${model.outputCostPerMtok}` : "—";
			const caps = (model.capabilities ?? []).join(",") || "—";

			const row = [
				`  ${model.id.padEnd(idWidth)}`,
				model.displayName.padEnd(nameWidth),
				ctx.padEnd(7),
				inCost.padEnd(8),
				outCost.padEnd(9),
				caps,
			].join("  ");

			console.log(row);
		}
	}
}

function runModelsList(argv: string[]): number {
	let providerFilter: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		if ((argv[i] === "--provider" || argv[i] === "-p") && i + 1 < argv.length) {
			providerFilter = argv[++i];
		}
	}

	const configDir = getAgentConfigDir();
	const result = loadRegistry(configDir);

	if (!result.ok) {
		console.error(chalk.red(`No registry available: ${result.error}`));
		console.error(chalk.dim(`Run \`caveman models update\` to fetch the latest registry.`));
		return 1;
	}

	console.log(chalk.dim(`Registry v${result.registry.version} (${result.source})`));
	printRegistry(result.registry, providerFilter);
	return 0;
}

function runModelsInspect(argv: string[]): number {
	const modelId = argv[0];
	if (!modelId) {
		console.error(chalk.red("Usage: caveman models inspect <model-id>"));
		return 1;
	}

	const configDir = getAgentConfigDir();
	const result = loadRegistry(configDir);

	if (!result.ok) {
		console.error(chalk.red(`No registry available: ${result.error}`));
		return 1;
	}

	// Search across all providers
	for (const provider of result.registry.providers) {
		for (const model of provider.models) {
			if (model.id === modelId) {
				console.log(`\n${chalk.bold(model.displayName)} (${model.id})`);
				console.log(`  Provider:       ${provider.name} (${provider.id})`);
				console.log(`  Kind:           ${provider.kind}`);
				console.log(`  Auth:           ${provider.auth}`);
				if (provider.baseUrl) {
					console.log(`  Base URL:       ${provider.baseUrl}`);
				}
				console.log(`  Context window: ${model.contextWindow.toLocaleString()} tokens`);
				if (model.maxOutputTokens !== undefined) {
					console.log(`  Max output:     ${model.maxOutputTokens.toLocaleString()} tokens`);
				}
				if (model.inputCostPerMtok !== undefined) {
					console.log(`  Input cost:     $${model.inputCostPerMtok} / Mtok`);
				}
				if (model.outputCostPerMtok !== undefined) {
					console.log(`  Output cost:    $${model.outputCostPerMtok} / Mtok`);
				}
				if (model.capabilities && model.capabilities.length > 0) {
					console.log(`  Capabilities:   ${model.capabilities.join(", ")}`);
				}
				return 0;
			}
		}
	}

	console.error(chalk.red(`Model "${modelId}" not found in registry.`));
	console.error(chalk.dim(`Run \`caveman models list\` to see available models.`));
	return 1;
}

function printModelsHelp(): void {
	console.log(`${chalk.bold("caveman models")} — manage the provider/model registry

${chalk.bold("Usage:")}
  caveman models update [--channel stable|beta]    Fetch latest registry
  caveman models list [--provider <id>]            List registry providers/models
  caveman models inspect <model-id>               Show model details

${chalk.bold("Examples:")}
  caveman models update                    Fetch stable registry
  caveman models update --channel beta     Fetch beta/canary registry
  caveman models list                      List all providers and models
  caveman models list --provider anthropic List only Anthropic models
  caveman models inspect claude-sonnet-4-5 Show Claude Sonnet details
`);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

/**
 * Handle `caveman models <subcmd> [...args]`.
 * Returns the process exit code, or -1 if this is not a models command.
 */
export async function handleModelsCommand(argv: string[]): Promise<number | -1> {
	if (argv[0] !== "models") return -1;

	const subcmd = argv[1];
	const rest = argv.slice(2);

	switch (subcmd) {
		case "update":
			return runModelsUpdate(rest);
		case "list":
			return runModelsList(rest);
		case "inspect":
			return runModelsInspect(rest);
		case "--help":
		case "-h":
		case undefined:
			printModelsHelp();
			return 0;
		default:
			console.error(chalk.red(`Unknown subcommand: models ${subcmd}`));
			printModelsHelp();
			return 1;
	}
}
