/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@juliusbrussee/caveman-code";

/**
 * Resolve the cave-bundled agents dir from inside this extension's own
 * source location. The extension is shipped at
 * `<cave-package>/examples/extensions/subagent/agents.ts`; the bundled
 * agents live at `<cave-package>/agents/`. Walking up three levels gets us
 * to the cave package root. We avoid taking a dependency on a getter exported
 * from `@juliusbrussee/caveman-code` so the extension keeps loading cleanly
 * against any published cave version that ships its agents at that path.
 */
function getBundledAgentsDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "agents");
}

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project" | "bundled";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project" | "bundled"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	// #62: cave's project config dir is `.cave/`; the pre-rebrand `.pi/` is kept
	// as a fallback so projects mid-migration still resolve. Cave-canonical wins
	// at the same level of the tree.
	let currentDir = cwd;
	while (true) {
		const cave = path.join(currentDir, ".cave", "agents");
		if (isDirectory(cave)) return cave;
		const pi = path.join(currentDir, ".pi", "agents");
		if (isDirectory(pi)) return pi;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function findNearestProjectClaudeAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".claude", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const bundledDir = getBundledAgentsDir();
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	// #59 stage 2: cross-platform discovery (Claude Code only in V1). OFF by
	// default; opt in via env var. Cave's canonical dirs are scanned BEFORE the
	// CC alias dirs at the same scope, then last-write-wins inside the map keeps
	// CC entries when there's no cave entry, or cave entries when both exist
	// (since cave is later in the user-scope order below).
	const crossPlatformEnabled = process.env.CAVE_CROSS_PLATFORM_AGENTS === "true";
	const userClaudeDir = crossPlatformEnabled ? path.join(os.homedir(), ".claude", "agents") : null;
	const projectClaudeDir = crossPlatformEnabled ? findNearestProjectClaudeAgentsDir(cwd) : null;

	// Bundled agents (scout, planner, worker, etc.) shipped with cave are always
	// available as a baseline; user-scope and project-scope override by name.
	const bundledAgents = loadAgentsFromDir(bundledDir, "bundled");
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const userClaudeAgents = scope === "project" || !userClaudeDir ? [] : loadAgentsFromDir(userClaudeDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
	const projectClaudeAgents =
		scope === "user" || !projectClaudeDir ? [] : loadAgentsFromDir(projectClaudeDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	// Precedence: bundled < user-CC < user-cave < project-CC < project-cave.
	// Last write wins. Cave canonical dirs scanned AFTER CC at the same scope so
	// a cave-native agent of the same name overrides its CC sibling.
	for (const agent of bundledAgents) agentMap.set(agent.name, agent);
	if (scope === "both" || scope === "user") {
		for (const agent of userClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	}
	if (scope === "both" || scope === "project") {
		for (const agent of projectClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
