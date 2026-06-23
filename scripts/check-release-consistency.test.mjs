import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReleaseConsistency } from "./check-release-consistency.mjs";

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRepo(options = {}) {
	const root = mkdtempSync(join(tmpdir(), "release-consistency-"));
	mkdirSync(join(root, "packages", "ai"), { recursive: true });
	mkdirSync(join(root, "packages", "agent"), { recursive: true });
	const version = options.version ?? "0.65.11";
	const staleRange = options.staleRange ?? `^${version}`;
	const agentVersion = options.agentVersion ?? version;
	writeJson(join(root, "package.json"), {
		private: true,
		workspaces: ["packages/*"],
		dependencies: { "@zhachory1/mewrite-agent": staleRange },
	});
	writeJson(join(root, "packages", "ai", "package.json"), {
		name: "@zhachory1/mewrite-ai",
		version,
	});
	writeFileSync(join(root, "packages", "ai", "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
	writeJson(join(root, "packages", "agent", "package.json"), {
		name: "@zhachory1/mewrite-agent",
		version: agentVersion,
		dependencies: { "@zhachory1/mewrite-ai": `^${version}` },
	});
	writeFileSync(join(root, "packages", "agent", "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
	writeJson(join(root, "package-lock.json"), {
		lockfileVersion: 3,
		packages: {
			"": { dependencies: { "@zhachory1/mewrite-agent": staleRange } },
			"packages/ai": { name: "@zhachory1/mewrite-ai", version },
			"packages/agent": {
				name: "@zhachory1/mewrite-agent",
				version: agentVersion,
				dependencies: { "@zhachory1/mewrite-ai": `^${version}` },
			},
		},
	});
	return root;
}

test("passes when workspaces, internal ranges, lockfile, and changelogs align", () => {
	const root = makeRepo();
	const result = checkReleaseConsistency(root);
	assert.equal(result.ok, true, result.errors.join("\n"));
});

test("fails when workspace versions diverge", () => {
	const root = makeRepo({ agentVersion: "0.65.12" });
	const result = checkReleaseConsistency(root);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /not lockstep/);
});

test("fails stale root internal dependency ranges", () => {
	const root = makeRepo({ staleRange: "^0.65.2" });
	const result = checkReleaseConsistency(root);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /package\.json: @zhachory1\/mewrite-agent range is \^0\.65\.2/);
});

test("fails stale lockfile workspace package versions", () => {
	const root = makeRepo();
	const lockPath = join(root, "package-lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	lock.packages["packages/agent"].version = "0.65.10";
	writeJson(lockPath, lock);
	const result = checkReleaseConsistency(root);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /package-lock\.json:packages\/agent: version is 0\.65\.10/);
});

test("allows star peer dependency ranges for internal packages", () => {
	const root = makeRepo();
	const pkgPath = join(root, "packages", "agent", "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	pkg.peerDependencies = { "@zhachory1/mewrite-ai": "*" };
	writeJson(pkgPath, pkg);
	const lockPath = join(root, "package-lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	lock.packages["packages/agent"].peerDependencies = { "@zhachory1/mewrite-ai": "*" };
	writeJson(lockPath, lock);
	const result = checkReleaseConsistency(root);
	assert.equal(result.ok, true, result.errors.join("\n"));
});
