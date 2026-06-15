// Stdio transport integration test — spawns a real subprocess speaking MCP
// JSON-RPC over stdin/stdout and verifies the round-trip.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StdioTransport } from "../mcp/transport/stdio.js";

const SERVER_SOURCE = String.raw`
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test", version: "0" } } }) + "\n");
    } else if (msg.method === "notifications/initialized") {
      // no response
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo back", inputSchema: { type: "object" } }] } }) + "\n");
    } else if (msg.method === "tools/call") {
      const args = msg.params?.arguments ?? {};
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echoed:" + JSON.stringify(args) }] } }) + "\n");
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown method" } }) + "\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let tmpDir: string;
let scriptPath: string;

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cave-mcp-stdio-"));
	scriptPath = join(tmpDir, "fake-server.cjs");
	writeFileSync(scriptPath, SERVER_SOURCE);
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("StdioTransport", () => {
	it("connects to a real subprocess, lists tools, calls a tool", async () => {
		const transport = new StdioTransport(
			{ name: "fake", command: process.execPath, args: [scriptPath] },
			{ requestTimeoutMs: 5_000, connectTimeoutMs: 5_000 },
		);
		await transport.connect();
		expect(transport.isConnected()).toBe(true);
		const tools = await transport.listTools();
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("echo");
		expect(tools[0].namespacedName).toBe("mcp__fake__echo");

		const result = (await transport.callTool("echo", { hi: "there" })) as { content: Array<{ text: string }> };
		expect(result.content[0].text).toContain("echoed:");
		expect(result.content[0].text).toContain("there");

		await transport.close();
		expect(transport.isConnected()).toBe(false);
	});

	it("fails gracefully when the spawned process can't be launched", async () => {
		const transport = new StdioTransport(
			{ name: "fake", command: "/nonexistent/cave-mcp-server-please-no" },
			{ requestTimeoutMs: 1_000, connectTimeoutMs: 1_000 },
		);
		await expect(transport.connect()).rejects.toThrow();
	});

	it("requires a command", async () => {
		const transport = new StdioTransport({ name: "fake" });
		await expect(transport.connect()).rejects.toThrow(/command is required/);
	});

	// Issue #17 MED 4 — child process listeners were never removed in close(),
	// leaking a listener per connect/close cycle (and the `exit` handler fired
	// `fatal()` during our own teardown). close() must detach them.
	it("removes all child process listeners on close (no listener leak)", async () => {
		const transport = new StdioTransport(
			{ name: "fake", command: process.execPath, args: [scriptPath] },
			{ requestTimeoutMs: 5_000, connectTimeoutMs: 5_000 },
		);
		await transport.connect();

		// Reach the live child to inspect its registered listeners.
		const child = (transport as unknown as { child?: import("node:child_process").ChildProcess }).child;
		expect(child).toBeDefined();
		const c = child as import("node:child_process").ChildProcess;

		// While connected, the long-lived listeners are present.
		expect(c.listenerCount("exit")).toBeGreaterThan(0);
		expect(c.listenerCount("error")).toBeGreaterThan(0);
		expect(c.stdout?.listenerCount("data") ?? 0).toBeGreaterThan(0);
		expect(c.stderr?.listenerCount("data") ?? 0).toBeGreaterThan(0);

		await transport.close();

		// After close every long-lived listener must be detached.
		expect(c.listenerCount("exit")).toBe(0);
		expect(c.listenerCount("error")).toBe(0);
		expect(c.stdout?.listenerCount("data") ?? 0).toBe(0);
		expect(c.stderr?.listenerCount("data") ?? 0).toBe(0);
	});
});
