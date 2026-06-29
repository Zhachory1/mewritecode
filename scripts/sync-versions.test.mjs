import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "sync-versions.js");

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

test("updates root and workspace internal dependency ranges", () => {
	const root = mkdtempSync(join(tmpdir(), "sync-versions-"));
	mkdirSync(join(root, "packages", "coding-agent"), { recursive: true });
	mkdirSync(join(root, "packages", "agent"), { recursive: true });

	writeJson(join(root, "package.json"), {
		name: "root",
		dependencies: { "@zhachory1/mewrite-code": "^1.0.0" },
	});
	writeJson(join(root, "packages", "coding-agent", "package.json"), {
		name: "@zhachory1/mewrite-code",
		version: "2.0.0",
	});
	writeJson(join(root, "packages", "agent", "package.json"), {
		name: "@zhachory1/mewrite-agent",
		version: "2.0.0",
		devDependencies: { "@zhachory1/mewrite-code": "^1.0.0" },
		optionalDependencies: { "@zhachory1/mewrite-code": "^1.0.0" },
		peerDependencies: { "@zhachory1/mewrite-code": "*" },
	});

	execFileSync(process.execPath, [scriptPath], { cwd: root, stdio: "pipe" });

	const rootPkg = readJson(join(root, "package.json"));
	const agentPkg = readJson(join(root, "packages", "agent", "package.json"));

	assert.equal(rootPkg.dependencies["@zhachory1/mewrite-code"], "^2.0.0");
	assert.equal(agentPkg.devDependencies["@zhachory1/mewrite-code"], "^2.0.0");
	assert.equal(agentPkg.optionalDependencies["@zhachory1/mewrite-code"], "^2.0.0");
	assert.equal(agentPkg.peerDependencies["@zhachory1/mewrite-code"], "*");
});
