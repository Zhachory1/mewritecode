/**
 * `mewrite desktop`: launch the Electron desktop app shipped inside this package.
 * Electron is not bundled (~300MB); the pinned version installs once per user.
 */

import { type ExecFileSyncOptions, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { APP_NAME, getAgentDir, getPackageDir, isBunBinary } from "../config.js";

type Run = (command: string, args: string[], options: ExecFileSyncOptions) => unknown;

function electronBinary(dir: string): string | undefined {
	const electron = join(dir, "node_modules", "electron");
	const pathFile = join(electron, "path.txt");
	if (!existsSync(pathFile)) return undefined;
	const binary = join(electron, "dist", readFileSync(pathFile, "utf8").trim());
	return existsSync(binary) ? binary : undefined;
}

export function ensureElectron(
	version: string,
	{ root = join(getAgentDir(), "desktop"), run = execFileSync as Run }: { root?: string; run?: Run } = {},
): string {
	const target = join(root, `electron-${version}`);
	const ready = electronBinary(target);
	if (ready) return ready;
	const staging = `${target}.tmp-${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	try {
		console.error(`Installing Electron ${version} for ${APP_NAME} desktop (first run only)...`);
		// Scripts stay off so npm's install-script policy can't skip the download;
		// Electron's own installer then fetches and checksum-verifies the binary.
		run(
			"npm",
			[
				"install",
				"--prefix",
				staging,
				"--no-save",
				"--no-package-lock",
				"--no-audit",
				"--no-fund",
				"--ignore-scripts",
				`electron@${version}`,
			],
			{ stdio: "inherit" },
		);
		run(process.execPath, [join(staging, "node_modules", "electron", "install.js")], { stdio: "inherit" });
		rmSync(target, { recursive: true, force: true });
		renameSync(staging, target);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
	const binary = electronBinary(target);
	if (!binary) throw new Error(`Electron ${version} installed without its app binary. Delete ${target} and retry.`);
	return binary;
}

export async function handleDesktopCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "desktop") return false;
	try {
		const appDir = join(getPackageDir(), "desktop");
		if (!existsSync(join(appDir, "main.cjs"))) {
			console.error(
				`This ${APP_NAME} install has no desktop app. Install it with npm: npm install -g @zhachory1/mewrite-code`,
			);
			process.exit(1);
		}
		const { electronVersion } = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			electronVersion: string;
		};
		const binary = ensureElectron(electronVersion);
		// Run this install's CLI as the agent runtime so desktop and CLI versions match.
		const env = {
			...process.env,
			MEWRITE_BIN: isBunBinary ? process.execPath : process.argv[1],
			PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
		};
		spawn(binary, [appDir], { detached: true, stdio: "ignore", env }).unref();
		console.error(`Opening ${APP_NAME} desktop...`);
		process.exit(0);
	} catch (error) {
		console.error(`Could not open ${APP_NAME} desktop: ${(error as Error).message}`);
		process.exit(1);
	}
}
