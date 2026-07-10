import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZbrainProvider } from "../memory/zbrain.js";

function fakeZbrain(): string {
	const dir = join(tmpdir(), `zbrain-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "zbrain");
	writeFileSync(
		path,
		`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "init") {
  fs.mkdirSync(path.join(process.cwd(), ".zbrain"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".zbrain", "config.json"), "{}");
  console.log(JSON.stringify({ root: "." }));
  process.exit(0);
}
if (cmd === "import") {
  fs.mkdirSync(path.join(process.cwd(), ".zbrain"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".zbrain", "imported"), "yes");
  console.log(JSON.stringify({ import: { indexed: { documents: 1 } } }));
  process.exit(0);
}
if (cmd === "status") {
  console.log(JSON.stringify({ schemaVersion: 1, status: { dbExists: true, documents: 2, chunks: 3 } }));
  process.exit(0);
}
if (cmd === "search") {
  console.log(JSON.stringify({ schemaVersion: 1, results: [{ rank: 7, id: "notes/test.md", score: 0.5, path: "notes/test.md", lineStart: 4, snippet: "remembered zbrain fact" }] }));
  process.exit(0);
}
if (cmd === "get") {
  console.log(JSON.stringify({ schemaVersion: 1, document: { id: args[1], title: "Test", provenance: { path: args[1] }, content: "# Test\\n\\nremembered zbrain fact" } }));
  process.exit(0);
}
console.error("unknown " + cmd);
process.exit(1);
`,
	);
	chmodSync(path, 0o755);
	return path;
}

describe("ZbrainProvider", () => {
	let dirs: string[] = [];

	beforeEach(() => {
		dirs = [];
	});

	afterEach(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	function workspace(): string {
		const dir = join(tmpdir(), `zbrain-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		dirs.push(dir);
		return dir;
	}

	it("reports status from zbrain", async () => {
		const root = workspace();
		const provider = new ZbrainProvider({ command: fakeZbrain(), workspace: root });

		await expect(provider.isAvailable()).resolves.toBe(true);
		await expect(provider.status()).resolves.toMatchObject({ dbExists: true, documents: 2, chunks: 3 });
	});

	it("searches and expands zbrain documents", async () => {
		const root = workspace();
		const provider = new ZbrainProvider({ command: fakeZbrain(), workspace: root });

		const hits = await provider.search("zbrain", { limit: 1 });
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ id: 7, kind: "zbrain" });
		expect(hits[0].preview).toContain("remembered zbrain fact");

		const observations = await provider.getObservations([7]);
		expect(observations).toHaveLength(1);
		expect(observations[0].content).toContain("remembered zbrain fact");
		expect(observations[0].metadata?.path).toBe("notes/test.md");
	});

	it("saves markdown into the configured collection and imports the workspace", async () => {
		const root = workspace();
		const provider = new ZbrainProvider({
			command: fakeZbrain(),
			workspace: root,
			defaultCollection: "learnings",
			now: () => new Date("2026-07-09T12:00:00.000Z"),
		});

		await provider.save("Use zbrain for durable memory.", "lesson", { session_id: "s1" });

		const collection = join(root, "learnings");
		const files = readdirSync(collection);
		expect(files).toHaveLength(1);
		const saved = readFileSync(join(collection, files[0]), "utf8");
		expect(saved).toContain('kind: "lesson"');
		expect(saved).toContain('session_id: "s1"');
		expect(saved).toContain("Use zbrain for durable memory.");
		expect(existsSync(join(root, ".zbrain", "imported"))).toBe(true);
	});
});
