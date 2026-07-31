import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@zhachory1/mewrite-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../../../src/core/sdk.js";
import { readTool } from "../../../src/core/tools/index.js";

// Issue #127 follow-up: the always-on MCP bridge tools were being *registered*
// into the session by _buildRuntime, but createAgentSession() pinned a fixed
// initialActiveToolNames list (read/bash/edit/write/task/agent) that omitted
// them. Because _buildRuntime prefers options.activeToolNames over its own
// computed default, mcp_tool_search / mcp_tool_call (and memory_* tools) were
// registered but never activated — so `mcp list` showed servers, no error
// fired, yet the model had no MCP tools.
//
// The original #127 test exercised AgentSession directly through the harness,
// which never sets initialActiveToolNames, so it could not catch this. This
// test drives the real sdk.ts entry point.
describe("issue #127 MCP tools active through createAgentSession", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-127-sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		// Isolate HOME so user-level ~/.mewrite/mcp.json can't leak real servers
		// into discovery and mask the behavior under test.
		originalHome = process.env.HOME;
		process.env.HOME = join(tempDir, "home");
		mkdirSync(process.env.HOME, { recursive: true });
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("activates mcp_tool_search + mcp_tool_call when a project mcp.json has a server", async () => {
		writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { example: { command: "true", args: [] } } }));

		const model = getModel("anthropic", "claude-sonnet-4-5");
		expect(model).toBeTruthy();

		const { session } = await createAgentSession({ cwd, agentDir, model: model! });
		await session.whenReady;

		const active = session.getActiveToolNames();
		expect(active).toContain("mcp_tool_search");
		expect(active).toContain("mcp_tool_call");
		// Default loadout must still be active.
		expect(active).toContain("task");
		expect(active).toContain("agent");

		session.dispose();
	});

	it("does not activate MCP bridge tools when no mcp.json is present", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5");
		expect(model).toBeTruthy();

		const { session } = await createAgentSession({ cwd, agentDir, model: model! });
		await session.whenReady;

		const active = session.getActiveToolNames();
		expect(active).not.toContain("mcp_tool_search");
		expect(active).not.toContain("mcp_tool_call");

		session.dispose();
	});

	it("honors an explicit tools list without injecting MCP tools", async () => {
		writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { example: { command: "true", args: [] } } }));

		const model = getModel("anthropic", "claude-sonnet-4-5");
		expect(model).toBeTruthy();

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: model!,
			tools: [readTool],
		});
		await session.whenReady;

		const active = session.getActiveToolNames();
		expect(active).toEqual(["read"]);

		session.dispose();
	});
});
