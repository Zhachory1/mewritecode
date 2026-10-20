import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

await build({
	absWorkingDir: root,
	entryPoints: ["packages/desktop/editor-source.mjs"],
	outfile: "packages/desktop/editor-bundle.js",
	bundle: true,
	format: "iife",
	platform: "browser",
	minify: true,
});

const assets = join(root, "packages", "desktop", "assets");
mkdirSync(assets, { recursive: true });
cpSync(join(root, "node_modules", "marked", "marked.min.js"), join(assets, "marked.min.js"));
