// Tests for /mcp slash command handler.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_SLASH_COMMAND, parseMcpSlash, runMcpSlashCommand } from "../mcp.js";

describe("MCP_SLASH_COMMAND metadata", () => {
	it("registers the /mcp name and description", () => {
		expect(MCP_SLASH_COMMAND.name).toBe("mcp");
		expect(MCP_SLASH_COMMAND.description).toContain("MCP");
	});
});

describe("parseMcpSlash", () => {
	it("defaults to list when no verb", () => {
		expect(parseMcpSlash("/mcp")).toEqual({ verb: "list", args: [] });
		expect(parseMcpSlash("/mcp ")).toEqual({ verb: "list", args: [] });
	});

	it("parses verbs and args", () => {
		expect(parseMcpSlash("/mcp doctor")).toEqual({ verb: "doctor", args: [] });
		expect(parseMcpSlash("/mcp login github")).toEqual({ verb: "login", args: ["github"] });
		expect(parseMcpSlash("/mcp add fs npx -y server")).toEqual({
			verb: "add",
			args: ["fs", "npx", "-y", "server"],
		});
	});
});

describe("runMcpSlashCommand", () => {
	let cwd: string;
	let HOME_BACKUP: string | undefined;
	let fakeHome: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "cave-mcp-slash-"));
		fakeHome = mkdtempSync(join(tmpdir(), "cave-mcp-home-"));
		HOME_BACKUP = process.env.HOME;
		process.env.HOME = fakeHome;
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(fakeHome, { recursive: true, force: true });
		if (HOME_BACKUP === undefined) delete process.env.HOME;
		else process.env.HOME = HOME_BACKUP;
	});

	it("/mcp list with no servers shows discovery hint", async () => {
		const result = await runMcpSlashCommand("/mcp", { cwd });
		expect(result.errors).toBe(0);
		expect(result.lines.join("\n")).toMatch(/No MCP servers configured/);
	});

	it("/mcp list shows configured servers", async () => {
		writeFileSync(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: { fs: { command: "echo", args: ["hi"] } },
			}),
		);
		const result = await runMcpSlashCommand("/mcp list", { cwd });
		expect(result.errors).toBe(0);
		expect(result.lines.join("\n")).toMatch(/fs \[stdio\]/);
	});

	it("/mcp login without name fails", async () => {
		const result = await runMcpSlashCommand("/mcp login", { cwd });
		expect(result.errors).toBe(1);
		expect(result.lines.join("\n")).toMatch(/Usage/);
	});

	it("/mcp login with name returns OAuth stub explanation", async () => {
		const result = await runMcpSlashCommand("/mcp login github", { cwd });
		expect(result.errors).toBe(0);
		expect(result.lines.join("\n")).toMatch(/OAuth/);
	});

	it("unknown verb fails with hint", async () => {
		const result = await runMcpSlashCommand("/mcp wat", { cwd });
		expect(result.errors).toBe(1);
		expect(result.lines.join("\n")).toMatch(/Unknown/);
	});

	it("/mcp doctor with no servers reports cleanly", async () => {
		const result = await runMcpSlashCommand("/mcp doctor", { cwd });
		expect(result.errors).toBe(0);
		expect(result.lines.join("\n")).toMatch(/No MCP servers/);
	});

	it("/mcp reload signals success", async () => {
		const result = await runMcpSlashCommand("/mcp reload", { cwd });
		expect(result.errors).toBe(0);
	});

	it("/mcp add hints to use CLI", async () => {
		const result = await runMcpSlashCommand("/mcp add fs npx -y server", { cwd });
		expect(result.errors).toBe(0);
		expect(result.lines.join("\n")).toMatch(/caveman mcp add/);
	});
});
