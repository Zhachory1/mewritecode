#!/usr/bin/env node
/**
 * Release script for Me Write Code
 *
 * Usage: node scripts/release.mjs <major|minor|patch>
 *
 * Steps:
 * 1. Check for uncommitted changes
 * 2. Bump version via npm run version:xxx
 * 3. Update CHANGELOG.md files: keep [Unreleased], add [version] - date below it
 * 4. Commit and tag
 * 5. Publish to npm
 * 6. Push main and tag
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

function run(cmd, options = {}) {
	console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: options.silent ? "pipe" : "inherit", ...options });
	} catch (e) {
		if (!options.ignoreError) {
			console.error(`Command failed: ${cmd}`);
			process.exit(1);
		}
		return null;
	}
}

function getVersion() {
	const pkg = JSON.parse(readFileSync("packages/ai/package.json", "utf-8"));
	return pkg.version;
}

function getChangelogs() {
	const packagesDir = "packages";
	const packages = readdirSync(packagesDir);
	return packages.map((pkg) => join(packagesDir, pkg, "CHANGELOG.md")).filter((path) => existsSync(path));
}

export function finalizeChangelogContent(content, version, date) {
	if (!content.includes("## [Unreleased]")) {
		return { updated: false, content };
	}
	return {
		updated: true,
		content: content.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`),
	};
}

function updateChangelogsForRelease(version) {
	const date = new Date().toISOString().split("T")[0];
	const changelogs = getChangelogs();

	for (const changelog of changelogs) {
		const content = readFileSync(changelog, "utf-8");
		const result = finalizeChangelogContent(content, version, date);
		if (!result.updated) {
			console.log(`  Skipping ${changelog}: no [Unreleased] section`);
			continue;
		}
		writeFileSync(changelog, result.content);
		console.log(`  Updated ${changelog}`);
	}
}

function main() {
	const bumpType = process.argv[2];
	if (!["major", "minor", "patch"].includes(bumpType)) {
		console.error("Usage: node scripts/release.mjs <major|minor|patch>");
		process.exit(1);
	}

	console.log("\n=== Release Script ===\n");

	// 1. Check for uncommitted changes
	console.log("Checking for uncommitted changes...");
	const status = run("git status --porcelain", { silent: true });
	if (status && status.trim()) {
		console.error("Error: Uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
	console.log("  Working directory clean\n");

	// 2. Bump version
	console.log(`Bumping version (${bumpType})...`);
	run(`npm run version:${bumpType}`);
	const version = getVersion();
	console.log(`  New version: ${version}\n`);

	// 3. Verify release consistency before changelog/tag/publish
	console.log("Checking release consistency...");
	run("npm run check:release-consistency");
	console.log();

	// 4. Update changelogs while preserving fresh [Unreleased] sections for publish-time checks.
	console.log("Updating CHANGELOG.md files...");
	updateChangelogsForRelease(version);
	console.log();

	// 5. Commit and tag
	console.log("Committing and tagging...");
	run("git add .");
	run(`git commit -m "Release v${version}"`);
	run(`git tag -a v${version} -m "v${version}"`);
	console.log();

	// 6. Publish
	console.log("Publishing to npm...");
	run("npm run publish");
	console.log();

	// 7. Push
	console.log("Pushing to remote...");
	run("git push origin main");
	run(`git push origin v${version}`);
	console.log();

	console.log(`=== Released v${version} ===`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
