#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INTERNAL_SCOPE = "@zhachory1/mewrite-";
const RANGE_PREFIX = "^";

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function expandWorkspacePattern(rootDir, pattern) {
	if (!pattern.endsWith("/*")) return [pattern];
	const base = pattern.slice(0, -2);
	const absBase = join(rootDir, base);
	if (!existsSync(absBase)) return [];
	return readdirSync(absBase, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(base, entry.name));
}

export function findWorkspacePackageDirs(rootDir, rootPackage) {
	const dirs = [];
	for (const pattern of rootPackage.workspaces ?? []) {
		for (const dir of expandWorkspacePattern(rootDir, pattern)) {
			if (existsSync(join(rootDir, dir, "package.json"))) dirs.push(dir);
		}
	}
	return [...new Set(dirs)].sort();
}

function collectInternalVersions(workspacePackages) {
	const map = new Map();
	for (const pkg of workspacePackages) {
		if (typeof pkg.name === "string" && pkg.name.startsWith(INTERNAL_SCOPE)) {
			map.set(pkg.name, pkg.version);
		}
	}
	return map;
}

function checkInternalRanges(errors, owner, deps, expectedVersion, options = {}) {
	if (!deps) return;
	for (const [name, range] of Object.entries(deps)) {
		if (!name.startsWith(INTERNAL_SCOPE)) continue;
		if (options.allowStar && range === "*") continue;
		const expected = `${RANGE_PREFIX}${expectedVersion}`;
		if (range !== expected) {
			errors.push(`${owner}: ${name} range is ${range}, expected ${expected}`);
		}
	}
}

function checkPackageDeps(errors, owner, pkg, expectedVersion) {
	checkInternalRanges(errors, owner, pkg.dependencies, expectedVersion);
	checkInternalRanges(errors, owner, pkg.devDependencies, expectedVersion);
	checkInternalRanges(errors, owner, pkg.optionalDependencies, expectedVersion);
	checkInternalRanges(errors, owner, pkg.peerDependencies, expectedVersion, { allowStar: true });
}

function checkChangelog(errors, rootDir, dir) {
	if (!dir.startsWith("packages/") || dir.split("/").length !== 2) return;
	const changelog = join(rootDir, dir, "CHANGELOG.md");
	if (!existsSync(changelog)) return;
	const text = readFileSync(changelog, "utf8");
	if (!text.includes("## [Unreleased]")) {
		errors.push(`${dir}/CHANGELOG.md: missing ## [Unreleased] section`);
	}
}

function checkLockPackage(errors, lock, lockPath, pkg, expectedVersion) {
	const locked = lock.packages?.[lockPath];
	if (!locked) {
		errors.push(`package-lock.json: missing package entry ${lockPath}`);
		return;
	}
	if (locked.version !== pkg.version) {
		errors.push(`package-lock.json:${lockPath}: version is ${locked.version}, expected ${pkg.version}`);
	}
	checkPackageDeps(errors, `package-lock.json:${lockPath}`, locked, expectedVersion);
}

export function checkReleaseConsistency(rootDir = process.cwd()) {
	const errors = [];
	const rootPackagePath = join(rootDir, "package.json");
	const lockPath = join(rootDir, "package-lock.json");
	const rootPackage = readJson(rootPackagePath);
	const workspaceDirs = findWorkspacePackageDirs(rootDir, rootPackage);
	const workspacePackages = workspaceDirs.map((dir) => ({ dir, pkg: readJson(join(rootDir, dir, "package.json")) }));
	const internalVersions = collectInternalVersions(workspacePackages.map((entry) => entry.pkg));
	const versions = [...new Set(internalVersions.values())].sort();

	if (versions.length === 0) {
		errors.push("no @zhachory1/mewrite-* workspace packages found");
	} else if (versions.length > 1) {
		errors.push(`workspace versions are not lockstep: ${versions.join(", ")}`);
	}

	const expectedVersion = versions[0] ?? "0.0.0";
	checkPackageDeps(errors, "package.json", rootPackage, expectedVersion);

	for (const { dir, pkg } of workspacePackages) {
		if (pkg.name?.startsWith(INTERNAL_SCOPE) && pkg.version !== expectedVersion) {
			errors.push(`${dir}/package.json: version is ${pkg.version}, expected ${expectedVersion}`);
		}
		checkPackageDeps(errors, `${dir}/package.json`, pkg, expectedVersion);
		checkChangelog(errors, rootDir, dir);
	}

	if (!existsSync(lockPath)) {
		errors.push("package-lock.json is missing");
	} else {
		const lock = readJson(lockPath);
		const lockedRoot = lock.packages?.[""];
		if (!lockedRoot) {
			errors.push("package-lock.json: missing root package entry");
		} else {
			checkPackageDeps(errors, "package-lock.json:", lockedRoot, expectedVersion);
		}
		for (const { dir, pkg } of workspacePackages) {
			checkLockPackage(errors, lock, dir, pkg, expectedVersion);
		}
	}

	return { ok: errors.length === 0, errors, expectedVersion, workspaceCount: workspacePackages.length };
}

function main() {
	const result = checkReleaseConsistency(process.cwd());
	if (!result.ok) {
		console.error("Release consistency check failed:");
		for (const error of result.errors) console.error(`  - ${error}`);
		process.exit(1);
	}
	console.log(`Release consistency OK (${result.workspaceCount} workspaces at ${result.expectedVersion})`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
