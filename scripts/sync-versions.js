#!/usr/bin/env node

/**
 * Syncs ALL @zhachory1/mewrite-* package dependency versions to match their current versions.
 * This ensures lockstep versioning across the monorepo.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const packagesDir = join(process.cwd(), "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
	.filter((dirent) => dirent.isDirectory())
	.map((dirent) => dirent.name);

// Read all package.json files and build version map
const packages = {};
const versionMap = {};

for (const dir of packageDirs) {
	const pkgPath = join(packagesDir, dir, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		packages[dir] = { path: pkgPath, data: pkg };
		versionMap[pkg.name] = pkg.version;
	} catch (e) {
		console.error(`Failed to read ${pkgPath}:`, e.message);
	}
}

console.log("Current versions:");
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

// Verify all versions are the same (lockstep)
const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
	console.error("\n❌ ERROR: Not all packages have the same version!");
	console.error("Expected lockstep versioning. Run one of:");
	console.error("  npm run version:patch");
	console.error("  npm run version:minor");
	console.error("  npm run version:major");
	process.exit(1);
}

console.log("\n✅ All packages at same version (lockstep)");

const rootPkgPath = join(process.cwd(), "package.json");
let rootPackage;
try {
	rootPackage = { path: rootPkgPath, data: JSON.parse(readFileSync(rootPkgPath, "utf8")) };
} catch (e) {
	console.error(`Failed to read ${rootPkgPath}:`, e.message);
}

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const syncTargets = [...Object.values(packages), ...(rootPackage ? [rootPackage] : [])];

// Update all inter-package dependencies
let totalUpdates = 0;
for (const pkg of syncTargets) {
	let updated = false;
	const packageName = pkg.data.name ?? "root package";

	for (const field of dependencyFields) {
		const deps = pkg.data[field];
		if (!deps) continue;
		for (const [depName, currentVersion] of Object.entries(deps)) {
			if (!versionMap[depName]) continue;
			if (field === "peerDependencies" && currentVersion === "*") continue;
			const newVersion = `^${versionMap[depName]}`;
			if (currentVersion !== newVersion) {
				console.log(`\n${packageName}:`);
				const suffix = field === "dependencies" ? "" : ` (${field})`;
				console.log(`  ${depName}: ${currentVersion} → ${newVersion}${suffix}`);
				deps[depName] = newVersion;
				updated = true;
				totalUpdates++;
			}
		}
	}

	// Write if updated
	if (updated) {
		writeFileSync(pkg.path, JSON.stringify(pkg.data, null, "\t") + "\n");
	}
}

if (totalUpdates === 0) {
	console.log("\nAll inter-package dependencies already in sync.");
} else {
	console.log(`\n✅ Updated ${totalUpdates} dependency version(s)`);
}
