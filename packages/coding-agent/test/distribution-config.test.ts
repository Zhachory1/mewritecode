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

	function runConfigProbe(env: NodeJS.ProcessEnv): Record<string, string> {
		const code = [
			'import { APP_NAME, CONFIG_DIR_NAME, ENV_PACKAGE_DIR, getPackageDir } from "./src/config.ts";',
			"console.log(JSON.stringify({ appName: APP_NAME, configDirName: CONFIG_DIR_NAME, envPackageDir: ENV_PACKAGE_DIR, packageDir: getPackageDir() }));",
		].join("\n");
		const out = execFileSync("npx", ["tsx", "-e", code], {
			cwd: process.cwd(),
			env: { ...process.env, ...env },
			encoding: "utf8",
		});
		return JSON.parse(out) as Record<string, string>;
	}

	it("uses the generic package-dir bootstrap env before package metadata is loaded", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "roktcode-package-"));
		created.push(packageDir);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "@rokt/roktcode", version: "1.2.3", mewriteConfig: { name: "roktcode" } }),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir });
		expect(result.packageDir).toBe(packageDir);
		expect(result.appName).toBe("roktcode");
	});

	it("exports a downstream package-dir env name from metadata", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "roktcode-package-"));
		const overrideDir = mkdtempSync(join(tmpdir(), "roktcode-override-"));
		created.push(packageDir, overrideDir);
		mkdirSync(overrideDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@rokt/roktcode",
				version: "1.2.3",
				mewriteConfig: { name: "roktcode", configDir: ".roktcode", packageDirEnv: "ROKTCODE_PACKAGE_DIR" },
			}),
		);

		const result = runConfigProbe({ CODING_AGENT_PACKAGE_DIR: packageDir, ROKTCODE_PACKAGE_DIR: overrideDir });
		expect(result.envPackageDir).toBe("ROKTCODE_PACKAGE_DIR");
		expect(result.configDirName).toBe(".roktcode");
		expect(result.packageDir).toBe(overrideDir);
	});
});
