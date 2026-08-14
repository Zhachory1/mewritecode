import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("distribution config", () => {
	const created: string[] = [];

	afterEach(() => {
		for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function runRuntimeProbe(env: NodeJS.ProcessEnv): Record<string, unknown> {
		const code = [
			'import { DefaultResourceLoader } from "./src/core/resource-loader.ts";',
			'import { loadAgentDefs } from "./src/core/agent-defs/loader.ts";',
			"async function main() {",
			"const cwd = process.env.TEST_CWD;",
			"const agentDir = process.env.TEST_AGENT_DIR;",
			"const loader = new DefaultResourceLoader({ cwd, agentDir });",
			"await loader.reload();",
			"const agents = loadAgentDefs({ cwd, userDir: agentDir }).agents.map((a) => a.def.name);",
			"console.log(JSON.stringify({ skills: loader.getSkills().skills.map((s) => s.name), prompts: loader.getPrompts().prompts.map((p) => p.name), agents }));",
			"}",
			"main().catch((err) => { console.error(err); process.exit(1); });",
		].join("\n");
		const out = execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
		return JSON.parse(out) as Record<string, unknown>;
	}

	function runConfigProbe(env: NodeJS.ProcessEnv): Record<string, unknown> {
		const code = [
			'import { APP_NAME, BANNER_LOGO_MAX_WIDTH_CELLS, BANNER_LOGO_PATH, BANNER_TAGLINE, CHANGELOG_URL, COMPRESSION_MODE_NAME, CONFIG_DIR_NAME, DEFAULT_THEME_NAME, DISPLAY_NAME, DISTRIBUTION_APPEND_SYSTEM_PROMPT, DISTRIBUTION_SYSTEM_PROMPT_BRANDING, DOCS_URL, ENV_PACKAGE_DIR, GITHUB_URL, MCP_DISCOVERY_OPTIONS, SAVINGS_NAME, SYSTEM_PROMPT_BRANDING, WATCH_MARKER, getDistributionAgentPaths, getDistributionExtensionPaths, getDistributionMcpConfigPaths, getDistributionPromptPaths, getDistributionSkillPaths, getDistributionThemePaths, getPackageDir, getThemesDir } from "./src/config.ts";',
			"console.log(JSON.stringify({ appName: APP_NAME, displayName: DISPLAY_NAME, configDirName: CONFIG_DIR_NAME, envPackageDir: ENV_PACKAGE_DIR, packageDir: getPackageDir(), themesDir: getThemesDir(), distributionExtensionPaths: getDistributionExtensionPaths(), distributionSkillPaths: getDistributionSkillPaths(), distributionPromptPaths: getDistributionPromptPaths(), distributionThemePaths: getDistributionThemePaths(), distributionAgentPaths: getDistributionAgentPaths(), distributionMcpConfigPaths: getDistributionMcpConfigPaths(), mcp: MCP_DISCOVERY_OPTIONS, watchMarker: WATCH_MARKER, bannerLogoPath: BANNER_LOGO_PATH, bannerLogoMaxWidthCells: BANNER_LOGO_MAX_WIDTH_CELLS, bannerTagline: BANNER_TAGLINE, defaultThemeName: DEFAULT_THEME_NAME, githubUrl: GITHUB_URL, docsUrl: DOCS_URL, changelogUrl: CHANGELOG_URL, systemPromptBranding: SYSTEM_PROMPT_BRANDING, distributionSystemPromptBranding: DISTRIBUTION_SYSTEM_PROMPT_BRANDING, distributionAppendSystemPrompt: DISTRIBUTION_APPEND_SYSTEM_PROMPT, compressionModeName: COMPRESSION_MODE_NAME, savingsName: SAVINGS_NAME }));",
		].join("\n");
		const out = execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
		return JSON.parse(out) as Record<string, unknown>;
	}

	// Render the banner logo (theme initialized) and return the visible-text lines
	// with ANSI stripped, so tests can assert pencil vs. standalone wordmark.
	function runBannerProbe(env: NodeJS.ProcessEnv): string[] {
		const code = [
			'import { initTheme } from "./src/modes/interactive/theme/theme.ts";',
			'import { renderPencilLogo } from "./src/modes/interactive/components/banner.ts";',
			'initTheme("dark");',
			'const lines = renderPencilLogo(80).map((l) => l.replace(/\\x1b\\[[0-9;]*m/g, ""));',
			"console.log(JSON.stringify(lines));",
		].join("\n");
		const out = execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
		return JSON.parse(out) as string[];
	}

	// Init the theme through the standalone-CLI path (initDistributionTheme) and
	// return the accent color's rendered SGR, so tests can assert a distribution
	// theme is actually applied rather than the built-in fallback.
	function runThemeAccentProbe(env: NodeJS.ProcessEnv): string {
		const code = [
			'import { initDistributionTheme, theme } from "./src/modes/interactive/theme/theme.ts";',
			'import { SettingsManager } from "./src/core/settings-manager.ts";',
			"initDistributionTheme(SettingsManager.create().getTheme());",
			'console.log(theme.fg("accent", "X"));',
		].join("\n");
		return execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
	}

	function runPromptProbe(env: NodeJS.ProcessEnv): string {
		const code = [
			'import { buildSystemPrompt } from "./src/core/system-prompt.ts";',
			"console.log(buildSystemPrompt({ selectedTools: [], contextFiles: [], skills: [] }));",
		].join("\n");
		return execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
	}

	it("uses the generic package-dir bootstrap env before package metadata is loaded", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "@example/examplecode", version: "1.2.3", mewriteConfig: { name: "examplecode" } }),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.packageDir).toBe(packageDir);
		expect(result.themesDir).not.toBe(join(packageDir, "dist", "modes", "interactive", "theme"));
		expect(result.appName).toBe("examplecode");
		expect(result.watchMarker).toBe("examplecode");
	});

	it("exports a downstream package-dir env name from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		const overrideDir = mkdtempSync(join(tmpdir(), "examplecode-override-"));
		created.push(packageDir, overrideDir);
		mkdirSync(overrideDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: { name: "examplecode", configDir: ".examplecode", packageDirEnv: "EXAMPLECODE_PACKAGE_DIR" },
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir, EXAMPLECODE_PACKAGE_DIR: overrideDir });
		expect(result.envPackageDir).toBe("EXAMPLECODE_PACKAGE_DIR");
		expect(result.configDirName).toBe(".examplecode");
		expect(result.packageDir).toBe(overrideDir);
	});

	it("exports downstream MCP discovery policy from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: {
					name: "examplecode",
					configDir: ".examplecode",
					mcp: {
						includeRootProjectConfig: false,
						includeProjectConfigDir: false,
						includeUserConfigDir: false,
						legacyConfigDirNames: [],
						includeClaudeConfig: false,
						includeCodexConfig: false,
					},
				},
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.mcp).toEqual({
			configDirName: ".examplecode",
			legacyConfigDirNames: [],
			includeRootProjectConfig: false,
			includeProjectConfigDir: false,
			includeUserConfigDir: false,
			includeClaudeConfig: false,
			includeCodexConfig: false,
			packageConfigPath: join(packageDir, ".mcp.json"),
			packageConfigPaths: [join(packageDir, ".mcp.json")],
		});
	});

	it("exports downstream package resource paths from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: {
					name: "examplecode",
					resources: {
						extensions: ["./extensions"],
						skills: ["./skills"],
						prompts: ["./prompts"],
						themes: ["./resource-themes"],
						agents: ["./agents", "./extra-agents"],
						mcp: ["./mcp/defaults.json"],
					},
					theme: { paths: ["./themes/example-dark.json"] },
				},
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.distributionExtensionPaths).toEqual([join(packageDir, "extensions")]);
		expect(result.distributionSkillPaths).toEqual([join(packageDir, "skills")]);
		expect(result.distributionPromptPaths).toEqual([join(packageDir, "prompts")]);
		expect(result.distributionThemePaths).toEqual([
			join(packageDir, "themes", "example-dark.json"),
			join(packageDir, "resource-themes"),
		]);
		expect(result.distributionAgentPaths).toEqual([join(packageDir, "agents"), join(packageDir, "extra-agents")]);
		expect(result.distributionMcpConfigPaths).toEqual([
			join(packageDir, ".mcp.json"),
			join(packageDir, "mcp", "defaults.json"),
		]);
	});

	it("loads downstream package skills, prompts, and agents from resource paths", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		const agentDir = mkdtempSync(join(tmpdir(), "examplecode-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "examplecode-project-"));
		created.push(packageDir, agentDir, cwd);
		mkdirSync(join(packageDir, "skills", "wrapper-skill"), { recursive: true });
		mkdirSync(join(packageDir, "prompts"), { recursive: true });
		mkdirSync(join(packageDir, "agents"), { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: {
					name: "examplecode",
					resources: { skills: ["./skills"], prompts: ["./prompts"], agents: ["./agents"] },
				},
			}),
		);
		writeFileSync(
			join(packageDir, "skills", "wrapper-skill", "SKILL.md"),
			`---
name: wrapper-skill
description: Wrapper skill
---
Skill body`,
		);
		writeFileSync(
			join(packageDir, "prompts", "wrapper-prompt.md"),
			`---
description: Wrapper prompt
---
Prompt body`,
		);
		writeFileSync(
			join(packageDir, "agents", "wrapper-agent.md"),
			`---
name: wrapper-agent
description: Wrapper agent
---
Agent body`,
		);

		const result = runRuntimeProbe({ CODING_AGENT_PACKAGE_DIR: packageDir, TEST_CWD: cwd, TEST_AGENT_DIR: agentDir });
		expect(result.skills).toContain("wrapper-skill");
		expect(result.prompts).toContain("wrapper-prompt");
		expect(result.agents).toContain("wrapper-agent");
	});

	it("exports downstream branding, watch marker, URLs, and default theme from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: {
					name: "examplecode",
					displayName: "Example Code",
					branding: {
						logoPath: "./assets/logo.png",
						logoMaxWidthCells: 42,
						tagline: "Ship Example",
						watchMarker: "example",
						githubUrl: "https://github.example.com/example/code",
						docsUrl: "https://docs.example.com/code",
						changelogUrl: "https://docs.example.com/code/changelog",
						systemPromptName: "Example Agent",
						systemPromptCliName: "example",
						systemPromptHarnessDescription: "an Example coding harness",
						documentationLabel: "Example Agent docs",
						compressionModeName: "Example compression",
						savingsName: "Example Agent",
					},
					theme: { default: "example-dark", paths: ["./themes/example-dark.json"] },
				},
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.displayName).toBe("Example Code");
		expect(result.watchMarker).toBe("example");
		expect(result.bannerLogoPath).toBe(join(packageDir, "assets", "logo.png"));
		expect(result.bannerLogoMaxWidthCells).toBe(42);
		expect(result.bannerTagline).toBe("Ship Example");
		expect(result.defaultThemeName).toBe("example-dark");
		expect(result.distributionThemePaths).toEqual([join(packageDir, "themes", "example-dark.json")]);
		expect(result.githubUrl).toBe("https://github.example.com/example/code");
		expect(result.docsUrl).toBe("https://docs.example.com/code");
		expect(result.changelogUrl).toBe("https://docs.example.com/code/changelog");
		expect(result.systemPromptBranding).toEqual({
			productDisplayName: "Example Agent",
			productCliName: "example",
			productHarnessDescription: "an Example coding harness",
			documentationLabel: "Example Agent docs",
		});
		expect(result.compressionModeName).toBe("Example compression");
		expect(result.savingsName).toBe("Example Agent");
	});

	it("exports downstream system prompt options from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "roktcode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/roktcode",
				version: "1.2.3",
				mewriteConfig: {
					name: "roktcode",
					systemPromptBranding: {
						productDisplayName: "Roktcode",
						productCliName: "roktcode",
						productHarnessDescription: "a Rokt-specific coding agent harness",
						documentationLabel: "Roktcode documentation",
					},
					appendSystemPrompt: "# Rokt context\n\nYou are a Rokt-specific coding agent.",
				},
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.distributionSystemPromptBranding).toEqual({
			productDisplayName: "Roktcode",
			productCliName: "roktcode",
			productHarnessDescription: "a Rokt-specific coding agent harness",
			documentationLabel: "Roktcode documentation",
		});
		expect(result.distributionAppendSystemPrompt).toBe("# Rokt context\n\nYou are a Rokt-specific coding agent.");
	});

	it("uses downstream branding in the default system prompt", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "roktcode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/roktcode",
				version: "1.2.3",
				mewriteConfig: {
					name: "roktcode",
					displayName: "Roktcode",
					configDir: ".roktcode",
					branding: {
						documentationLabel: "Roktcode docs",
						compressionModeName: "Roktcode compression",
						savingsName: "Roktcode",
					},
				},
			}),
		);

		const prompt = runPromptProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(prompt).toContain("operating inside Roktcode, a coding agent harness");
		expect(prompt).toContain("Roktcode docs (read only when the user asks about Roktcode itself, the roktcode CLI");
		expect(prompt).not.toContain("operating inside Cave");
		expect(prompt).not.toContain("Cave documentation");
	});

	it("renders a distribution primaryWordmark standalone, without the pencil", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		const wordmark = ["█▀█ █▀▀ █▀█", "█▀█ █▄▄ █▀█", "▀ ▀ ▀▀▀ ▀ ▀"];
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: { name: "examplecode", branding: { primaryWordmark: wordmark } },
			}),
		);

		const lines = runBannerProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		// Exactly the wordmark rows, no pencil.
		expect(lines.map((l) => l.trimEnd())).toEqual(wordmark);
		expect(lines.join("\n")).not.toContain("╭┴");
	});

	it("keeps the pencil + block wordmark when no primaryWordmark is set", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: { name: "examplecode" },
			}),
		);

		const lines = runBannerProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		// The pencil body is present in the default (no-branding) render.
		expect(lines.some((l) => l.includes("╭┴──┴╮"))).toBe(true);
	});

	it("applies the distribution default theme on the standalone CLI path (#205)", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "examplecode-package-"));
		created.push(packageDir);
		mkdirSync(join(packageDir, "themes"), { recursive: true });
		// Base a valid theme on the built-in dark so it passes schema validation,
		// then rename it and give it a distinctive accent.
		const dark = JSON.parse(readFileSync(join("src", "modes", "interactive", "theme", "dark.json"), "utf8")) as {
			name: string;
			colors: Record<string, string>;
		};
		dark.name = "acme-dark";
		dark.colors.accent = "#FF4FB3"; // 255;79;179
		writeFileSync(join(packageDir, "themes", "acme-dark.json"), JSON.stringify(dark));
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@example/examplecode",
				version: "1.2.3",
				mewriteConfig: {
					name: "examplecode",
					theme: { default: "acme-dark", paths: ["./themes/acme-dark.json"] },
				},
			}),
		);

		const accent = runThemeAccentProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		// The distribution accent (#FF4FB3) is applied, not the built-in orange
		// (255;107;53).
		expect(accent).toContain("38;2;255;79;179");
		expect(accent).not.toContain("38;2;255;107;53");
	});
});
