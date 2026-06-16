/**
 * Regression for #59 stage 1 — promote subagent extension to default-on.
 *
 * Council A r2 BLOCKER on self-import + MAJOR on test-must-cover-tool-registration:
 * a naive "extension is in the load result" check would pass even if the
 * extension's factory crashed or its tool registration silently failed. This
 * test drives discoverAndLoadExtensions end-to-end against an EMPTY user dir
 * (no manual install present) and asserts:
 *
 *   1. The bundled subagent extension is discovered.
 *   2. Its factory runs without error.
 *   3. The `subagent` tool is registered into the extension's tool map.
 *   4. The bundled sample agents (scout, planner, worker) are findable via
 *      the extension's own `discoverAgents` from the package agents dir.
 *
 * Council MAJOR on collision/precedence: a user-scope extension at
 * `<tempUserDir>/extensions/subagent/` should register at the same tool name,
 * giving the user override path. Today's behavior is documented (per-extension
 * tools map, last-load-wins in the registry); the test pins it so future
 * refactors of the precedence logic surface intentional changes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../../../examples/extensions/subagent/agents.js";
import { discoverAndLoadExtensions } from "../../../src/core/extensions/loader.js";

describe("#59 bundled subagent extension", () => {
	let tempUserDir: string;
	let tempCwd: string;

	beforeEach(() => {
		tempUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bundled-user-"));
		tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bundled-cwd-"));
	});

	afterEach(() => {
		fs.rmSync(tempUserDir, { recursive: true, force: true });
		fs.rmSync(tempCwd, { recursive: true, force: true });
	});

	it("loads the bundled subagent extension without any manual install", async () => {
		// Empty user + project dirs. No extensions configured. The only way the
		// extension can appear is via the new bundled-defaults discovery.
		const result = await discoverAndLoadExtensions([], tempCwd, tempUserDir);

		expect(result.errors).toEqual([]);
		const subagentExt = result.extensions.find((e) => e.path.includes("subagent"));
		expect(subagentExt, "subagent extension should be discovered from bundled defaults").toBeDefined();
	});

	it("registers the `subagent` tool when the bundled extension loads", async () => {
		const result = await discoverAndLoadExtensions([], tempCwd, tempUserDir);
		const subagentExt = result.extensions.find((e) => e.path.includes("subagent"));
		expect(subagentExt).toBeDefined();

		// `extension.tools` is a Map<toolName, {definition, sourceInfo}>. The
		// factory registers `subagent`. Council BLOCKER: a "load succeeded but
		// tool registration silently failed" outcome would slip past path-only
		// checks; pin the tool-map state.
		const tools = subagentExt!.tools;
		expect(tools.has("subagent"), "subagent tool must be in the extension's tool map").toBe(true);
		const subagentTool = tools.get("subagent");
		expect(subagentTool?.definition.name).toBe("subagent");
		expect(typeof subagentTool?.definition.execute).toBe("function");
	});

	it("discovers bundled sample agents (scout, planner, worker) via the extension's discoverAgents", () => {
		// Empty user + project dirs. The only agents visible should be the
		// bundled ones (those shipped in `packages/coding-agent/agents/`).
		// `getAgentDir()` reads the global agent dir from env or `~/.cave/agent/`,
		// which we can't easily override per test; instead point a fresh user
		// dir to a tempfs that's known-empty.
		const originalEnv = process.env.CAVE_AGENT_DIR ?? process.env.PI_AGENT_DIR;
		process.env.CAVE_AGENT_DIR = tempUserDir;
		process.env.PI_AGENT_DIR = tempUserDir;

		try {
			const result = discoverAgents(tempCwd, "user");
			const names = result.agents.map((a) => a.name).sort();

			expect(names, "scout/planner/worker must be discoverable from bundled defaults").toEqual(
				expect.arrayContaining(["scout", "planner", "worker"]),
			);

			// All three should be marked `source: "bundled"` since the user/project
			// dirs are empty.
			for (const name of ["scout", "planner", "worker"]) {
				const agent = result.agents.find((a) => a.name === name);
				expect(agent?.source).toBe("bundled");
			}
		} finally {
			if (originalEnv === undefined) {
				delete process.env.CAVE_AGENT_DIR;
				delete process.env.PI_AGENT_DIR;
			} else {
				process.env.CAVE_AGENT_DIR = originalEnv;
				process.env.PI_AGENT_DIR = originalEnv;
			}
		}
	});

	it("user-scope override: a user-installed subagent shadows the bundled one (by name)", async () => {
		// Drop a stub extension at the user-scope path that registers the same
		// tool name. The bundled one still loads; both end up in the result.
		// The runtime's tool-registration behavior (last-write-wins per the
		// extension API) is the policy; this test pins that BOTH extensions
		// load without erroring. Name-collision detection beyond this is filed
		// as a follow-up — see council notes.
		const userExtDir = path.join(tempUserDir, "extensions", "subagent");
		fs.mkdirSync(userExtDir, { recursive: true });
		fs.writeFileSync(
			path.join(userExtDir, "index.ts"),
			`
			import { Type } from "@sinclair/typebox";
			export default function(pi) {
				pi.registerTool({
					name: "subagent",
					label: "subagent (user override)",
					description: "user-scope override of the bundled subagent",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "user override" }] }),
				});
			}
		`,
		);

		const result = await discoverAndLoadExtensions([], tempCwd, tempUserDir);
		expect(result.errors).toEqual([]);

		// Both the bundled and user-scope extensions should be in the result.
		const subagentExts = result.extensions.filter((e) => e.path.includes("subagent"));
		expect(subagentExts.length, "both bundled and user-scope subagent extensions should load").toBe(2);

		// Each extension has its own tools map. The "last write wins" runtime
		// behavior happens at agent-side tool registration, not here. Confirm
		// both ARE registered, leaving the runtime resolution to the
		// (separately-tested) tool registry.
		const userExt = subagentExts.find((e) => e.path.startsWith(tempUserDir));
		const bundledExt = subagentExts.find((e) => !e.path.startsWith(tempUserDir));
		expect(userExt?.tools.has("subagent")).toBe(true);
		expect(bundledExt?.tools.has("subagent")).toBe(true);
	});
});
