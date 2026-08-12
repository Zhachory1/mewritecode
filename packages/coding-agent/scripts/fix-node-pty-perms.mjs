#!/usr/bin/env node
/**
 * node-pty ships prebuilt `spawn-helper` binaries, but the npm tarball extraction
 * drops the executable bit, so `pty.fork` fails at runtime with `posix_spawnp
 * failed`. Restore +x on every prebuilt (and legacy build/Release) spawn-helper.
 *
 * Best-effort and non-fatal: node-pty may be absent (e.g. optional install path)
 * or already correct. Runs as a postinstall for the coding-agent package.
 */

import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function findNodePtyRoot() {
	try {
		// Resolve from this package first, then fall back to CWD resolution so a
		// hoisted install (node-pty in a parent node_modules) is still found.
		const require = createRequire(import.meta.url);
		const pkg = require.resolve("node-pty/package.json", {
			paths: [process.cwd(), dirname(new URL(import.meta.url).pathname)],
		});
		return dirname(pkg);
	} catch {
		return null;
	}
}

function fixHelpersUnder(dir) {
	if (!existsSync(dir)) return 0;
	let fixed = 0;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			fixed += fixHelpersUnder(full);
		} else if (entry === "spawn-helper") {
			try {
				chmodSync(full, 0o755);
				fixed++;
			} catch {
				/* best-effort */
			}
		}
	}
	return fixed;
}

const root = findNodePtyRoot();
if (root) {
	// Modern node-pty uses prebuilds/<platform-arch>/spawn-helper; older builds
	// emit build/Release/spawn-helper. Cover both.
	fixHelpersUnder(join(root, "prebuilds"));
	fixHelpersUnder(join(root, "build"));
}
