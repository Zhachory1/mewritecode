/**
 * WS15: `/models` slash command for interactive mode.
 *
 * In-session registry commands:
 *   /models update [--channel stable|beta]  — fetch latest registry
 *   /models list [--provider <id>]          — list providers/models
 *   /models inspect <model-id>              — show model details
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { type FetchChannel, fetchAndCacheRegistry, getCachePath, loadRegistry } from "@zhachory1/mewrite-ai";

function getAgentConfigDir(): string {
	const envDir = process.env.CAVE_CODING_AGENT_DIR;
	if (envDir) return envDir;
	return join(homedir(), ".cave", "agent");
}

async function handleModelsUpdate(tokens: string[]): Promise<string> {
	let channel: FetchChannel = "stable";

	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "--channel" && i + 1 < tokens.length) {
			const ch = tokens[++i];
			if (ch === "stable" || ch === "beta") {
				channel = ch;
			} else {
				return `Unknown channel "${ch}". Use stable or beta.`;
			}
		}
	}

	const configDir = getAgentConfigDir();
	const cachePath = getCachePath(configDir);

	const result = await fetchAndCacheRegistry(cachePath, channel);
	if (!result.ok) {
		return `Failed to update registry: ${result.error}`;
	}

	const providerCount = result.registry.providers.length;
	const modelCount = result.registry.providers.reduce((sum, p) => sum + p.models.length, 0);

	return `Registry updated to v${result.registry.version} — ${providerCount} providers, ${modelCount} models`;
}

function handleModelsList(tokens: string[]): string {
	let providerFilter: string | undefined;

	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "--provider" && i + 1 < tokens.length) {
			providerFilter = tokens[++i];
		}
	}

	const configDir = getAgentConfigDir();
	const result = loadRegistry(configDir);

	if (!result.ok) {
		return `No registry available. Run /models update to fetch the latest registry.`;
	}

	const lines: string[] = [`Registry v${result.registry.version} (${result.source})`];

	const providers = providerFilter
		? result.registry.providers.filter(
				(p) => p.id === providerFilter || p.name.toLowerCase() === providerFilter!.toLowerCase(),
			)
		: result.registry.providers;

	if (providers.length === 0) {
		return `No provider matching "${providerFilter}"`;
	}

	for (const provider of providers) {
		lines.push(`\n${provider.name} (${provider.id}) [${provider.kind}] auth:${provider.auth}`);
		for (const model of provider.models) {
			const ctx =
				model.contextWindow >= 1_000_000
					? `${(model.contextWindow / 1_000_000).toFixed(1)}M`
					: `${Math.round(model.contextWindow / 1_000)}K`;
			const caps = (model.capabilities ?? []).join(",") || "—";
			lines.push(`  ${model.id}  ${model.displayName}  ctx:${ctx}  caps:${caps}`);
		}
	}

	return lines.join("\n");
}

function handleModelsInspect(tokens: string[]): string {
	const modelId = tokens[0];
	if (!modelId) {
		return "Usage: /models inspect <model-id>";
	}

	const configDir = getAgentConfigDir();
	const result = loadRegistry(configDir);

	if (!result.ok) {
		return `No registry available. Run /models update to fetch the latest registry.`;
	}

	for (const provider of result.registry.providers) {
		for (const model of provider.models) {
			if (model.id === modelId) {
				const lines = [
					`${model.displayName} (${model.id})`,
					`  Provider:    ${provider.name} (${provider.id})`,
					`  Kind:        ${provider.kind}`,
					`  Auth:        ${provider.auth}`,
					`  Context:     ${model.contextWindow.toLocaleString()} tokens`,
				];

				if (model.maxOutputTokens !== undefined) {
					lines.push(`  Max output:  ${model.maxOutputTokens.toLocaleString()} tokens`);
				}
				if (model.inputCostPerMtok !== undefined) {
					lines.push(`  Input cost:  $${model.inputCostPerMtok}/Mtok`);
				}
				if (model.outputCostPerMtok !== undefined) {
					lines.push(`  Output cost: $${model.outputCostPerMtok}/Mtok`);
				}
				if (model.capabilities && model.capabilities.length > 0) {
					lines.push(`  Capabilities: ${model.capabilities.join(", ")}`);
				}

				return lines.join("\n");
			}
		}
	}

	return `Model "${modelId}" not found. Run /models list to see available models.`;
}

const HELP = `/models — registry commands
  /models update [--channel stable|beta]   Fetch latest registry
  /models list [--provider <id>]           List providers/models
  /models inspect <model-id>              Show model details`;

/**
 * Handle /models slash command.
 *
 * @param input  Full slash command input (e.g. "models update --channel beta")
 * @returns String output to display, or null if not a models command.
 */
export async function handleModelsSlashCommand(input: string): Promise<string | null> {
	const trimmed = input.trim();
	if (!trimmed.startsWith("models")) return null;

	const tokens = trimmed.slice("models".length).trim().split(/\s+/).filter(Boolean);
	const subcmd = tokens[0];
	const rest = tokens.slice(1);

	switch (subcmd) {
		case "update":
			return handleModelsUpdate(rest);
		case "list":
			return handleModelsList(rest);
		case "inspect":
			return handleModelsInspect(rest);
		case "--help":
		case "help":
		case undefined:
			return HELP;
		default:
			return `Unknown subcommand "models ${subcmd}"\n\n${HELP}`;
	}
}
