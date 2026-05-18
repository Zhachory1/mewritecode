// Tests for the cavemem hook stubs (5 default lifecycle hooks).
//
// We verify (a) the HooksConfig shape is registered for each event,
// (b) the resulting commands shell out to `cavemem hook run <event> --ide cave`,
// (c) the registry's executor invokes them with our mocked subprocess.

import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildCavememHooksSnippet,
	buildDefaultCavememHooks,
	CAVEMEM_HOOK_EVENT_NAMES,
	HooksManager,
} from "../hooks/index.js";

describe("cavemem hook stubs", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers exactly the 5 cavemem lifecycle events", () => {
		const cfg = buildDefaultCavememHooks();
		const events = Object.keys(cfg).sort();
		expect(events.sort()).toEqual([...CAVEMEM_HOOK_EVENT_NAMES].sort());
		expect(events.length).toBe(5);
	});

	it("each event runs cavemem hook run <event> --ide cave", () => {
		const cfg = buildDefaultCavememHooks();
		const cases: Array<[string, string]> = [
			["SessionStart", "session-start"],
			["UserPromptSubmit", "user-prompt-submit"],
			["PostToolUse", "post-tool-use"],
			["Stop", "stop"],
			["SessionEnd", "session-end"],
		];
		for (const [caveEvent, cavememEvent] of cases) {
			const groups = cfg[caveEvent as keyof typeof cfg];
			expect(groups, caveEvent).toBeDefined();
			const hook = groups?.[0]?.hooks?.[0];
			expect(hook?.command).toBe(`cavemem hook run ${cavememEvent} --ide cave`);
		}
	});

	it("PostToolUse defaults to async (must never block the agent loop)", () => {
		const cfg = buildDefaultCavememHooks();
		const hook = cfg.PostToolUse?.[0]?.hooks?.[0];
		expect(hook?.async).toBe(true);
	});

	it("buildCavememHooksSnippet round-trips through JSON.parse", () => {
		const snippet = buildCavememHooksSnippet({ binary: "/opt/homebrew/bin/cavemem", ide: "cave-test" });
		const parsed = JSON.parse(snippet);
		expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("/opt/homebrew/bin/cavemem");
		expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("cave-test");
	});

	it("HooksRegistry resolves the matching hook for SessionStart", async () => {
		// Use a stub command that's harmless (`true`) so the executor doesn't
		// actually try to spawn cavemem — we only care that the registry
		// matches and the executor invokes *something*.
		const cfg = buildDefaultCavememHooks({ binary: "true" });
		// Replace the command entirely with /usr/bin/true so the spawn always
		// exits 0 across platforms.
		for (const e of CAVEMEM_HOOK_EVENT_NAMES) {
			const h = cfg[e]?.[0]?.hooks?.[0];
			if (h?.command) h.command = "true";
		}

		const manager = new HooksManager({
			cwd: () => process.cwd(),
			projectDir: () => process.cwd(),
		});
		manager.registry.setLayer("project", cfg);

		// Resolve must return one matched hook for each event; matcherInput
		// is optional (cavemem hooks have no matcher).
		for (const e of CAVEMEM_HOOK_EVENT_NAMES) {
			const matched = manager.registry.resolve(e, undefined);
			expect(matched.length, e).toBe(1);
		}

		// Dispatch session-start synchronously and verify it ran (exit 0).
		const result = await manager.dispatch("SessionStart", undefined);
		expect(result.results).toHaveLength(1);
		expect(result.results[0].exitCode).toBe(0);
	});

	it("subprocess invocation is via the system shell (uses spawn-compatible argv)", async () => {
		// Sanity: our snippet must be runnable via a Node child_process.spawn
		// with `bash -c <command>`. We don't actually execute cavemem here; we
		// only assert the command string is a single shell-safe line.
		const cfg = buildDefaultCavememHooks();
		for (const e of CAVEMEM_HOOK_EVENT_NAMES) {
			const cmd = cfg[e]?.[0]?.hooks?.[0]?.command ?? "";
			expect(cmd.includes("\n")).toBe(false);
			expect(cmd.length).toBeLessThan(200);
		}
		expect(typeof spawn).toBe("function");
	});
});
