import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMcpServers, removeMcpServer, saveMcpServer } from "../src/core/mcp-settings.js";

describe("MCP settings", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function setup() {
		const root = mkdtempSync(join(tmpdir(), "mewrite-mcp-settings-"));
		dirs.push(root);
		const cwd = join(root, "project");
		const home = join(root, "home");
		mkdirSync(cwd);
		mkdirSync(home);
		const projectFile = join(cwd, ".mcp.json");
		writeFileSync(
			projectFile,
			JSON.stringify({
				mcpServers: {
					basic: { command: "node", args: ["server.js"] },
					advanced: { command: "node", env: { TOKEN: "secret" } },
					remote: { url: "https://example.test/mcp" },
				},
			}),
		);
		return { cwd, home, projectFile };
	}

	it("lists servers with ownership and edit flags but no commands or secrets", () => {
		const { cwd, home } = setup();
		const inventory = getMcpServers(cwd, home);
		const byName = Object.fromEntries(inventory.servers.map((s) => [s.name, s]));
		expect(byName.basic).toMatchObject({ owner: "project", editable: true, removable: true, hasArguments: true });
		expect(byName.advanced).toMatchObject({ owner: "project", editable: false, removable: true });
		expect(byName.remote).toMatchObject({ owner: "project", transport: "http", editable: false, removable: false });
		expect(JSON.stringify(inventory)).not.toMatch(/server\.js|secret|example\.test/);
		expect(inventory.revisions.project).toMatch(/^[a-f0-9]{64}$/);
	});

	it("saves, renames, and removes stdio servers and keeps advanced entries intact", () => {
		const { cwd, home, projectFile } = setup();
		let revision = getMcpServers(cwd, home).revisions.project;
		saveMcpServer(
			{ scope: "project", revision, name: "docs", transport: "stdio", command: "npx", args: ["-y", "docs"] },
			cwd,
			home,
		);
		revision = getMcpServers(cwd, home).revisions.project;
		saveMcpServer(
			{
				scope: "project",
				revision,
				previousName: "docs",
				name: "docs2",
				transport: "stdio",
				command: "npx",
				args: [],
			},
			cwd,
			home,
		);
		revision = getMcpServers(cwd, home).revisions.project;
		removeMcpServer({ scope: "project", revision, name: "basic" }, cwd, home);

		const servers = JSON.parse(readFileSync(projectFile, "utf8")).mcpServers;
		expect(Object.keys(servers).sort()).toEqual(["advanced", "docs2", "remote"]);
		expect(servers.docs2).toEqual({ command: "npx", args: [], transport: "stdio" });
		expect(servers.advanced).toEqual({ command: "node", env: { TOKEN: "secret" } });
	});

	it("edits the legacy user config loadMcpConfig reads instead of shadowing it", () => {
		const { cwd, home } = setup();
		const legacy = join(home, ".cave", "mcp.json");
		mkdirSync(join(home, ".cave"));
		writeFileSync(legacy, JSON.stringify({ mcpServers: { old: { command: "node", args: [] } } }));
		const inventory = getMcpServers(cwd, home);
		expect(inventory.servers.find((s) => s.name === "old")).toMatchObject({ owner: "user", editable: true });
		saveMcpServer(
			{
				scope: "user",
				revision: inventory.revisions.user,
				name: "added",
				transport: "stdio",
				command: "uvx",
				args: [],
			},
			cwd,
			home,
		);
		expect(Object.keys(JSON.parse(readFileSync(legacy, "utf8")).mcpServers).sort()).toEqual(["added", "old"]);
		expect(existsSync(join(home, ".mewrite", "mcp.json"))).toBe(false);
	});

	it("writes user scope to the user config and rejects stale revisions and unsafe edits", () => {
		const { cwd, home, projectFile } = setup();
		const { revisions } = getMcpServers(cwd, home);
		saveMcpServer(
			{ scope: "user", revision: revisions.user, name: "mine", transport: "stdio", command: "uvx", args: [] },
			cwd,
			home,
		);
		expect(getMcpServers(cwd, home).servers.find((s) => s.name === "mine")?.owner).toBe("user");

		writeFileSync(projectFile, JSON.stringify({ mcpServers: {} }));
		expect(() =>
			removeMcpServer({ scope: "project", revision: revisions.project, name: "basic" }, cwd, home),
		).toThrow(/changed; refresh/);

		const fresh = getMcpServers(cwd, home).revisions;
		const save = (fields: object) =>
			saveMcpServer(
				{
					scope: "project",
					revision: fresh.project,
					name: "x",
					transport: "stdio",
					command: "node",
					args: [],
					...fields,
				},
				cwd,
				home,
			);
		expect(() => save({ name: "../bad" })).toThrow(/name/);
		expect(() => save({ command: "node\nrm -rf /" })).toThrow(/command/);
		expect(() => save({ transport: "http" })).toThrow(/stdio/);
		expect(JSON.parse(readFileSync(projectFile, "utf8"))).toEqual({ mcpServers: {} });
	});
});
