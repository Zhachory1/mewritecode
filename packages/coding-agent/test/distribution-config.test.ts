import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("distribution config", () => {
	const created: string[] = [];

	afterEach(() => {
		for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function runConfigProbe(env: NodeJS.ProcessEnv): Record<string, unknown> {
		const code = [
			'import { APP_NAME, BANNER_TAGLINE, CHANGELOG_URL, CONFIG_DIR_NAME, DEFAULT_THEME_NAME, DISPLAY_NAME, DOCS_URL, ENV_PACKAGE_DIR, GITHUB_URL, MCP_DISCOVERY_OPTIONS, WATCH_MARKER, getDistributionThemePaths, getPackageDir, getThemesDir } from "./src/config.ts";',
			"console.log(JSON.stringify({ appName: APP_NAME, displayName: DISPLAY_NAME, configDirName: CONFIG_DIR_NAME, envPackageDir: ENV_PACKAGE_DIR, packageDir: getPackageDir(), themesDir: getThemesDir(), distributionThemePaths: getDistributionThemePaths(), mcp: MCP_DISCOVERY_OPTIONS, watchMarker: WATCH_MARKER, bannerTagline: BANNER_TAGLINE, defaultThemeName: DEFAULT_THEME_NAME, githubUrl: GITHUB_URL, docsUrl: DOCS_URL, changelogUrl: CHANGELOG_URL }));",
		].join("\n");
		const out = execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
		return JSON.parse(out) as Record<string, unknown>;
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
		});
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
						tagline: "Ship Example",
						watchMarker: "example",
						githubUrl: "https://github.example.com/example/code",
						docsUrl: "https://docs.example.com/code",
						changelogUrl: "https://docs.example.com/code/changelog",
					},
					theme: { default: "example-dark", paths: ["./themes/example-dark.json"] },
				},
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.displayName).toBe("Example Code");
		expect(result.watchMarker).toBe("example");
		expect(result.bannerTagline).toBe("Ship Example");
		expect(result.defaultThemeName).toBe("example-dark");
		expect(result.distributionThemePaths).toEqual([join(packageDir, "themes", "example-dark.json")]);
		expect(result.githubUrl).toBe("https://github.example.com/example/code");
		expect(result.docsUrl).toBe("https://docs.example.com/code");
		expect(result.changelogUrl).toBe("https://docs.example.com/code/changelog");
	});
});
