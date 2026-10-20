import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureElectron } from "../src/cli/desktop.js";

function fakeInstall(calls: string[][]) {
	return (command: string, args: string[]) => {
		calls.push([command, ...args]);
		if (command === "npm") {
			mkdirSync(join(args[args.indexOf("--prefix") + 1], "node_modules", "electron"), { recursive: true });
			return;
		}
		const electron = join(args[0], "..");
		writeFileSync(join(electron, "path.txt"), "Electron.app/Contents/MacOS/Electron");
		mkdirSync(join(electron, "dist", "Electron.app", "Contents", "MacOS"), { recursive: true });
		writeFileSync(join(electron, "dist", "Electron.app", "Contents", "MacOS", "Electron"), "");
	};
}

describe("mewrite desktop", () => {
	it("installs the pinned Electron once with npm scripts off, then reuses it", () => {
		const root = mkdtempSync(join(tmpdir(), "mewrite-desktop-"));
		const calls: string[][] = [];
		const binary = ensureElectron("44.6.0", { root, run: fakeInstall(calls) });
		expect(binary).toBe(
			join(
				root,
				"electron-44.6.0",
				"node_modules",
				"electron",
				"dist",
				"Electron.app",
				"Contents",
				"MacOS",
				"Electron",
			),
		);
		expect(existsSync(binary)).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("--ignore-scripts");
		expect(calls[0]).toContain("electron@44.6.0");
		expect(calls[1][1]).toMatch(/node_modules[/\\]electron[/\\]install\.js$/);
		expect(readdirSync(root)).toEqual(["electron-44.6.0"]);
		expect(ensureElectron("44.6.0", { root, run: fakeInstall(calls) })).toBe(binary);
		expect(calls).toHaveLength(2);
	});

	it("leaves no partial install behind when the download fails", () => {
		const root = mkdtempSync(join(tmpdir(), "mewrite-desktop-"));
		const run = (command: string, args: string[]) => {
			if (command !== "npm") throw new Error("download failed");
			mkdirSync(join(args[args.indexOf("--prefix") + 1], "node_modules", "electron"), { recursive: true });
		};
		expect(() => ensureElectron("44.6.0", { root, run })).toThrow(/download failed/);
		expect(readdirSync(root)).toEqual([]);
	});
});
