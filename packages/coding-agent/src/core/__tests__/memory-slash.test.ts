// Tests for the /memory slash command dispatcher.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory } from "@zhachory1/mewrite-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseMemorySlash, runMemorySlashCommand } from "../slash-commands/memory.js";

const { FilesProvider } = memory;

function makeCtx(overrides: Partial<Parameters<typeof runMemorySlashCommand>[1]> = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "cave-memslash-"));
	const provider = new FilesProvider({ memoryDir: join(cwd, ".cave", "memory") });
	let enabled = true;
	const ctx = {
		cwd,
		provider,
		settings: {
			enabled: true,
			backend: "files" as const,
			workspace: join(cwd, ".cave", "memory"),
			capture: { requirePreview: true, defaultCollection: "inbox" },
			retrieval: { enabled: true, maxResults: 5 },
		},
		get enabled() {
			return enabled;
		},
		setEnabled: (next: boolean) => {
			enabled = next;
		},
		...overrides,
	};
	return { ctx, cwd, provider, getEnabled: () => enabled };
}

describe("/memory slash dispatcher", () => {
	let cleanup: string[] = [];

	beforeEach(() => {
		cleanup = [];
	});

	afterEach(() => {
		for (const d of cleanup) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	});

	it("parseMemorySlash defaults to 'show' when no verb given", () => {
		expect(parseMemorySlash("/memory")).toEqual({ verb: "show", args: [], rest: "" });
	});

	it("parseMemorySlash splits verb + args + rest", () => {
		expect(parseMemorySlash("/memory save  the agent did a thing")).toEqual({
			verb: "save",
			args: ["the", "agent", "did", "a", "thing"],
			rest: "the agent did a thing",
		});
	});

	it("/memory show prints provider, backend, workspace, and enabled state", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		const r = await runMemorySlashCommand("/memory show", ctx);
		expect(r.errors).toBe(0);
		expect(r.lines.some((l) => l.includes("provider:"))).toBe(true);
		expect(r.lines).toContain("backend: files");
		expect(r.lines.some((l) => l.startsWith("workspace:"))).toBe(true);
		expect(r.lines.some((l) => l.includes("enabled: yes"))).toBe(true);
	});

	it("/memory save persists when enabled, errors when off", async () => {
		const { ctx, cwd, provider } = makeCtx();
		cleanup.push(cwd);

		const preview = await runMemorySlashCommand("/memory save first fact", ctx);
		expect(preview.errors).toBe(0);
		expect(preview.lines.join("\n")).toContain("memory save preview");
		expect(provider.stats().entries).toBe(0);

		const r1 = await runMemorySlashCommand("/memory save --yes first fact", ctx);
		expect(r1.errors).toBe(0);
		expect(provider.stats().entries).toBe(1);

		const off = await runMemorySlashCommand("/memory off", ctx);
		expect(off.errors).toBe(0);

		const r2 = await runMemorySlashCommand("/memory save second fact", ctx);
		expect(r2.errors).toBe(1);
		expect(provider.stats().entries).toBe(1);
	});

	it("/memory search returns no-hits message when empty", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		const r = await runMemorySlashCommand("/memory search needle", ctx);
		expect(r.errors).toBe(0);
		expect(r.lines.join("\n")).toContain("no hits");
	});

	it("/memory search renders hits compactly after a save", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		await runMemorySlashCommand("/memory save --yes the magic word is xyzzy", ctx);
		const r = await runMemorySlashCommand("/memory search xyzzy", ctx);
		expect(r.errors).toBe(0);
		expect(r.lines.some((l) => l.includes("xyzzy"))).toBe(true);
	});

	it("/memory forget reports the count it asked to remove", async () => {
		const { ctx, cwd, provider } = makeCtx();
		cleanup.push(cwd);
		await runMemorySlashCommand("/memory save --yes tmp", ctx);
		await runMemorySlashCommand("/memory save --yes tmp2", ctx);
		const r = await runMemorySlashCommand("/memory forget 1 2", ctx);
		expect(r.errors).toBe(0);
		expect(provider.stats().entries).toBe(0);
	});

	it("/memory export writes a file", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		await runMemorySlashCommand("/memory save --yes export-target", ctx);
		const out = join(cwd, "out.jsonl");
		const r = await runMemorySlashCommand(`/memory export ${out}`, ctx);
		expect(r.errors).toBe(0);
		expect(r.lines.join("\n")).toContain(out);
	});

	it("/memory help renders the help banner", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		const r = await runMemorySlashCommand("/memory help", ctx);
		expect(r.errors).toBe(0);
		expect(r.lines.join("\n")).toContain("/memory search");
	});

	it("/memory unknown subcommand fails with help", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		const r = await runMemorySlashCommand("/memory wibble", ctx);
		expect(r.errors).toBe(1);
		expect(r.lines.join("\n")).toContain("/memory search");
	});

	it("/memory consolidate runs without an extractor and reports clusters", async () => {
		const { ctx, cwd } = makeCtx();
		cleanup.push(cwd);
		// We need a session id + timeline + observation bodies. The files
		// provider creates these implicitly when we save with a session_id.
		const sid = "consolidate-session";
		await ctx.provider.save("biome lint passed packages/agent index.ts", "episodic", { session_id: sid });
		await ctx.provider.save("biome lint passed packages/agent skills.ts", "episodic", { session_id: sid });
		await ctx.provider.save("biome lint passed packages/agent client.ts", "episodic", { session_id: sid });
		const r = await runMemorySlashCommand("/memory consolidate", ctx);
		expect(r.errors).toBe(0);
		expect(r.lines[0]).toContain("consolidation");
	});
});
