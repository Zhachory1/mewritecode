// Tests for the WS2 MCP loader, transports, and hub.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildNamespacedName,
	createInProcessTransport,
	getDiscoverySources,
	loadMcpConfig,
	McpHub,
	parseNamespacedName,
} from "../mcp/index.js";
import type { McpServerConfig, McpTransport } from "../mcp/types.js";

describe("namespacing", () => {
	it("builds and parses mcp__server__tool", () => {
		expect(buildNamespacedName("svc", "ping")).toBe("mcp__svc__ping");
		expect(parseNamespacedName("mcp__svc__ping")).toEqual({ server: "svc", tool: "ping" });
	});

	it("returns undefined for non-mcp names", () => {
		expect(parseNamespacedName("foo")).toBeUndefined();
		expect(parseNamespacedName("mcp__noseparator")).toBeUndefined();
	});

	it("handles tool names containing __", () => {
		expect(parseNamespacedName("mcp__svc__a__b")).toEqual({ server: "svc", tool: "a__b" });
	});
});

describe("loadMcpConfig", () => {
	let tmp: string;
	let home: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "cave-mcp-"));
		home = mkdtempSync(join(tmpdir(), "cave-home-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it("returns empty config when no files exist", () => {
		const result = loadMcpConfig(tmp, home);
		expect(result.servers).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
		expect(result.sources.length).toBeGreaterThan(0);
	});

	it("loads project .mcp.json (Claude Code byte-compat shape)", () => {
		const path = join(tmp, ".mcp.json");
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
					github: { url: "https://api.example.com/mcp", auth: "oauth" },
				},
			}),
		);
		const result = loadMcpConfig(tmp, home);
		expect(result.servers).toHaveLength(2);
		const fs = result.servers.find((s) => s.name === "filesystem");
		expect(fs?.command).toBe("npx");
		expect(fs?.args?.[0]).toBe("-y");
		const gh = result.servers.find((s) => s.name === "github");
		expect(gh?.url).toBe("https://api.example.com/mcp");
		expect(gh?.auth).toBe("oauth");
	});

	it("loads user ~/.cave/mcp.json", () => {
		const dir = join(home, ".cave");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "mcp.json"),
			JSON.stringify({ mcpServers: { user_only: { command: "echo", args: ["hi"] } } }),
		);
		const result = loadMcpConfig(tmp, home);
		expect(result.servers.map((s) => s.name)).toContain("user_only");
	});

	it("loads branded config paths before legacy fallbacks", () => {
		mkdirSync(join(home, ".brandcode"), { recursive: true });
		mkdirSync(join(home, ".cave"), { recursive: true });
		mkdirSync(join(tmp, ".brandcode"), { recursive: true });
		writeFileSync(join(home, ".cave", "mcp.json"), JSON.stringify({ mcpServers: { legacy: { command: "old" } } }));
		writeFileSync(
			join(home, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { branded: { command: "new" } } }),
		);
		writeFileSync(
			join(tmp, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { project: { command: "proj" } } }),
		);
		const result = loadMcpConfig(tmp, home, { configDirName: ".brandcode", legacyConfigDirNames: [".cave"] });
		expect(result.servers.map((s) => s.name).sort()).toEqual(["branded", "project"]);
		expect(getDiscoverySources(tmp, home, { configDirName: ".brandcode" }).map((s) => s.path)).toContain(
			join(home, ".brandcode", "mcp.json"),
		);
	});

	it("can read only a package-shipped .mcp.json", () => {
		const packageConfig = join(tmp, "package-dir", ".mcp.json");
		mkdirSync(join(tmp, "package-dir"), { recursive: true });
		mkdirSync(join(tmp, ".brandcode"), { recursive: true });
		mkdirSync(join(home, ".brandcode"), { recursive: true });
		mkdirSync(join(home, ".claude"), { recursive: true });
		mkdirSync(join(home, ".codex"), { recursive: true });
		writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: { root: { command: "root" } } }));
		writeFileSync(
			join(tmp, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { project: { command: "proj" } } }),
		);
		writeFileSync(
			join(home, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { user: { command: "user" } } }),
		);
		writeFileSync(join(home, ".claude", "mcp.json"), JSON.stringify({ mcpServers: { claude: { command: "cc" } } }));
		writeFileSync(join(home, ".codex", "mcp.json"), JSON.stringify({ mcpServers: { codex: { command: "cx" } } }));
		writeFileSync(packageConfig, JSON.stringify({ mcpServers: { packaged: { command: "pkg" } } }));

		const result = loadMcpConfig(tmp, home, {
			configDirName: ".brandcode",
			legacyConfigDirNames: [],
			includeRootProjectConfig: false,
			includeProjectConfigDir: false,
			includeUserConfigDir: false,
			includeClaudeConfig: false,
			includeCodexConfig: false,
			packageConfigPath: packageConfig,
		});
		expect(result.servers.map((s) => s.name)).toEqual(["packaged"]);
		expect(result.sources.map((s) => s.path)).toEqual([packageConfig]);
	});

	it("loads multiple package-shipped MCP configs before user and project overrides", () => {
		const packageDir = join(tmp, "package-dir");
		mkdirSync(packageDir, { recursive: true });
		const first = join(packageDir, "first.json");
		const second = join(packageDir, "second.json");
		mkdirSync(join(home, ".brandcode"), { recursive: true });
		mkdirSync(join(tmp, ".brandcode"), { recursive: true });
		writeFileSync(first, JSON.stringify({ mcpServers: { first: { command: "first" }, both: { command: "pkg" } } }));
		writeFileSync(second, JSON.stringify({ mcpServers: { second: { command: "second" } } }));
		writeFileSync(
			join(home, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { both: { command: "user" } } }),
		);
		writeFileSync(
			join(tmp, ".brandcode", "mcp.json"),
			JSON.stringify({ mcpServers: { both: { command: "project" } } }),
		);

		const result = loadMcpConfig(tmp, home, {
			configDirName: ".brandcode",
			legacyConfigDirNames: [],
			includeRootProjectConfig: false,
			packageConfigPaths: [first, second],
		});

		expect(result.servers.find((server) => server.name === "first")?.command).toBe("first");
		expect(result.servers.find((server) => server.name === "second")?.command).toBe("second");
		expect(result.servers.find((server) => server.name === "both")?.command).toBe("project");
		expect(result.sources.filter((source) => source.scope === "package").map((source) => source.path)).toEqual([
			first,
			second,
		]);
	});

	it("project config wins over user config on name collision", () => {
		mkdirSync(join(home, ".cave"), { recursive: true });
		writeFileSync(join(home, ".cave", "mcp.json"), JSON.stringify({ mcpServers: { both: { command: "user-cmd" } } }));
		writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: { both: { command: "project-cmd" } } }));
		const result = loadMcpConfig(tmp, home);
		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].command).toBe("project-cmd");
	});

	it("captures parse errors without throwing", () => {
		writeFileSync(join(tmp, ".mcp.json"), "{not valid json");
		const result = loadMcpConfig(tmp, home);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.servers).toHaveLength(0);
	});

	it("propagates settings from user file", () => {
		mkdirSync(join(home, ".cave"), { recursive: true });
		writeFileSync(
			join(home, ".cave", "mcp.json"),
			JSON.stringify({ mcpServers: {}, settings: { idleTimeout: 5, deferSchemas: true } }),
		);
		const result = loadMcpConfig(tmp, home);
		expect(result.settings.idleTimeout).toBe(5);
		expect(result.settings.deferSchemas).toBe(true);
	});

	it("discovery sources include project and user paths", () => {
		const sources = getDiscoverySources(tmp, home);
		expect(sources.some((s) => s.scope === "project")).toBe(true);
		expect(sources.some((s) => s.scope === "user")).toBe(true);
	});
});

describe("InProcessTransport", () => {
	it("connects, lists, and calls tools without subprocess", async () => {
		const transport = createInProcessTransport("svc", [
			{
				name: "echo",
				description: "echo back",
				schema: { type: "object" },
				call: (args: unknown) => ({ ok: true, args }),
			},
		]);
		expect(transport.kind).toBe("inproc");
		await transport.connect();
		expect(transport.isConnected()).toBe(true);
		const tools = await transport.listTools();
		expect(tools).toHaveLength(1);
		expect(tools[0].namespacedName).toBe("mcp__svc__echo");
		const result = (await transport.callTool("echo", { x: 1 })) as { ok: boolean; args: { x: number } };
		expect(result.ok).toBe(true);
		expect(result.args.x).toBe(1);
		await transport.close();
		expect(transport.isConnected()).toBe(false);
	});

	it("rejects calls before connect", async () => {
		const transport = createInProcessTransport("svc", []);
		await expect(transport.listTools()).rejects.toThrow(/not connected/);
		await expect(transport.callTool("x", {})).rejects.toThrow(/not connected/);
	});

	it("throws on missing tool", async () => {
		const transport = createInProcessTransport("svc", []);
		await transport.connect();
		await expect(transport.callTool("nope", {})).rejects.toThrow(/tool not found/);
	});
});

class StubTransport implements McpTransport {
	readonly kind = "inproc" as const;
	connected = false;
	calls: Array<{ name: string; args: unknown }> = [];
	constructor(
		private readonly name: string,
		private readonly tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
	) {}
	async connect() {
		this.connected = true;
	}
	async listTools() {
		return this.tools.map((t) => ({
			name: t.name,
			namespacedName: `mcp__${this.name}__${t.name}`,
			server: this.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));
	}
	async callTool(name: string, args: unknown) {
		this.calls.push({ name, args });
		return { name, args };
	}
	async close() {
		this.connected = false;
	}
	isConnected() {
		return this.connected;
	}
}

describe("McpHub", () => {
	function makeHub(configs: McpServerConfig[]): { hub: McpHub; stubs: Map<string, StubTransport> } {
		const stubs = new Map<string, StubTransport>();
		const hub = new McpHub({
			transportFactory: (config) => {
				const stub = new StubTransport(config.name, [
					{ name: "ping", description: `ping for ${config.name}` },
					{ name: "noisy", description: "loud", inputSchema: { type: "object" } },
				]);
				stubs.set(config.name, stub);
				return stub;
			},
		});
		for (const c of configs) hub.addServer(c);
		return { hub, stubs };
	}

	it("aggregates tools across servers under namespaced names", async () => {
		const { hub } = makeHub([
			{ name: "alpha", command: "x" },
			{ name: "beta", command: "y" },
		]);
		await hub.connectAll();
		const tools = await hub.listAllTools();
		const names = tools.map((t) => t.namespacedName).sort();
		expect(names).toEqual(["mcp__alpha__noisy", "mcp__alpha__ping", "mcp__beta__noisy", "mcp__beta__ping"]);
	});

	it("respects excludeTools", async () => {
		const { hub } = makeHub([{ name: "alpha", command: "x", excludeTools: ["noisy"] }]);
		await hub.connectAll();
		const tools = await hub.listAllTools();
		expect(tools.map((t) => t.name)).toEqual(["ping"]);
	});

	it("calls a namespaced tool by routing to the right transport", async () => {
		const { hub, stubs } = makeHub([{ name: "alpha", command: "x" }]);
		await hub.connectAll();
		await hub.callNamespaced("mcp__alpha__ping", { hello: 1 });
		const stub = stubs.get("alpha");
		expect(stub?.calls).toEqual([{ name: "ping", args: { hello: 1 } }]);
	});

	it("rejects calls to unknown servers", async () => {
		const { hub } = makeHub([]);
		await expect(hub.callNamespaced("mcp__missing__ping", {})).rejects.toThrow(/no server/);
	});

	it("buildToolSearchTool returns matching subset", async () => {
		const { hub } = makeHub([
			{ name: "alpha", command: "x" },
			{ name: "beta", command: "y" },
		]);
		await hub.connectAll();
		const search = hub.buildToolSearchTool();
		const all = (await search.call({})) as { results: Array<{ name: string }>; total: number };
		expect(all.total).toBe(4);

		const filtered = (await search.call({ query: "ping" })) as { results: Array<{ name: string }>; total: number };
		expect(filtered.total).toBe(2);
		expect(filtered.results.every((r) => r.name.endsWith("__ping"))).toBe(true);

		const byServer = (await search.call({ server: "alpha" })) as { results: unknown[]; total: number };
		expect(byServer.total).toBe(2);
	});

	it("addInProcess wires zero-spawn cave-side servers", async () => {
		const hub = new McpHub();
		hub.addInProcess("cave", [
			{
				name: "say_hi",
				description: "hi",
				schema: { type: "object" },
				call: () => ({ msg: "hi" }),
			},
		]);
		const results = await hub.connectAll();
		expect(results[0]).toEqual({ name: "cave" });
		const all = await hub.listAllTools();
		expect(all[0].namespacedName).toBe("mcp__cave__say_hi");
		const out = (await hub.callNamespaced("mcp__cave__say_hi", {})) as { msg: string };
		expect(out.msg).toBe("hi");
	});

	it("collects errors instead of throwing on connect failure", async () => {
		const hub = new McpHub({
			transportFactory: () => ({
				kind: "stdio" as const,
				connect: async () => {
					throw new Error("boom");
				},
				listTools: async () => [],
				callTool: async () => ({}),
				close: async () => {},
				isConnected: () => false,
			}),
		});
		hub.addServer({ name: "broken", command: "x" });
		const results = await hub.connectAll();
		expect(results[0].error).toMatch(/boom/);
	});

	it("sweepIdle disconnects servers past the threshold", async () => {
		const { hub, stubs } = makeHub([{ name: "alpha", command: "x" }]);
		await hub.connectAll();
		expect(stubs.get("alpha")?.connected).toBe(true);
		const swept = await hub.sweepIdle(Date.now() + 60 * 60 * 1000);
		expect(swept).toEqual(["alpha"]);
		expect(stubs.get("alpha")?.connected).toBe(false);
	});

	it("healthCheck reports per-server state", async () => {
		const { hub } = makeHub([{ name: "alpha", command: "x" }]);
		const health = await hub.healthCheck();
		expect(health[0].name).toBe("alpha");
		expect(health[0].reachable).toBe(true);
		expect(health[0].tools).toBe(2);
	});
});
