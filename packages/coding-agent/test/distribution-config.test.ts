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
			'import { APP_NAME, CONFIG_DIR_NAME, ENV_PACKAGE_DIR, MCP_DISCOVERY_OPTIONS, getPackageDir } from "./src/config.ts";',
			"console.log(JSON.stringify({ appName: APP_NAME, configDirName: CONFIG_DIR_NAME, envPackageDir: ENV_PACKAGE_DIR, packageDir: getPackageDir(), mcp: MCP_DISCOVERY_OPTIONS }));",
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
		expect(result.appName).toBe("examplecode");
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
});
