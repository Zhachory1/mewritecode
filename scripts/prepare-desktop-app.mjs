#!/usr/bin/env node
// Stage packages/desktop into @zhachory1/mewrite-code at pack time so `mewrite desktop` ships through npm.

import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "packages", "desktop");
const target = join(root, "packages", "coding-agent", "desktop");
const excluded = new Set(["test", "node_modules", "package.json", "editor-source.mjs"]);

// Child stdout goes to stderr so `npm pack --json` output stays parseable.
execFileSync(process.execPath, [join(root, "scripts", "build-desktop-editor.mjs")], { cwd: root, stdio: ["ignore", 2, 2] });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (path) => !excluded.has(relative(source, path).split(sep)[0]) });
const electronVersion = JSON.parse(readFileSync(join(root, "node_modules", "electron", "package.json"), "utf8")).version;
writeFileSync(
	join(target, "package.json"),
	`${JSON.stringify({ name: "mewrite-desktop", productName: "Me Write Code", private: true, main: "main.cjs", electronVersion }, null, "\t")}\n`,
);
