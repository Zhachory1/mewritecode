import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

// Issue #127: MCP servers configured in mcp.json were never surfaced to the
// model in a normal session. The bridge existed but nothing in the session run
// loop constructed a hub or registered mcp_tool_search / mcp_tool_call.
describe("issue #127 MCP tools in a normal session", () => {
	let harness: Harness | undefined;
	let originalHome: string | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	});

	function isolateHome(): string {
		originalHome = process.env.HOME;
		const home = mkdtempSync(join(tmpdir(), "pi-127-home-"));
		process.env.HOME = home;
		return home;
	}

	it("does not register MCP bridge tools when no server is configured", async () => {
		isolateHome();
		harness = await createHarness();
		await harness.session.whenReady;

		const active = harness.session.getActiveToolNames();
		expect(active).not.toContain("mcp_tool_search");
		expect(active).not.toContain("mcp_tool_call");
	});

	it("registers mcp_tool_search + mcp_tool_call when mcp.json has >=1 server", async () => {
		const home = isolateHome();
		mkdirSync(join(home, ".mewrite"), { recursive: true });
		writeFileSync(
			join(home, ".mewrite", "mcp.json"),
			JSON.stringify({ mcpServers: { example: { command: "true", args: [] } } }),
		);

		harness = await createHarness();
		await harness.session.whenReady;

		const active = harness.session.getActiveToolNames();
		expect(active).toContain("mcp_tool_search");
		expect(active).toContain("mcp_tool_call");
	});
});
