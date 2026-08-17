/**
 * #182 — `/cwd` command backing: AgentSession.setCwd changes the session's
 * working directory at runtime and re-points everything derived from it.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestSession } from "./utilities.js";

describe("AgentSession.setCwd (#182)", () => {
	const cleanups: Array<() => void> = [];
	const dirs: string[] = [];

	afterEach(() => {
		for (const c of cleanups.splice(0)) c();
		for (const d of dirs.splice(0)) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
	});

	function freshDir(): string {
		const d = mkdtempSync(join(tmpdir(), "setcwd-"));
		dirs.push(d);
		return d;
	}

	it("changes cwd to a valid absolute directory and updates the session manager", async () => {
		const { session, sessionManager, cleanup } = createTestSession();
		cleanups.push(cleanup);
		await session.whenReady;

		const target = freshDir();
		const resolved = await session.setCwd(target);

		expect(resolved).toBe(target);
		expect(session.cwd).toBe(target);
		expect(sessionManager.getCwd()).toBe(target);
		// Tools are still registered after the rebuild against the new cwd.
		expect(session.getActiveToolNames().length).toBeGreaterThan(0);
	});

	it("resolves a relative path against the current cwd", async () => {
		const parent = freshDir();
		mkdirSync(join(parent, "sub"), { recursive: true });
		const { session, cleanup } = createTestSession();
		cleanups.push(cleanup);
		await session.whenReady;

		await session.setCwd(parent);
		await session.setCwd("sub");
		expect(session.cwd).toBe(join(parent, "sub"));
	});

	it("expands a leading ~ to the home directory", async () => {
		const { session, cleanup } = createTestSession();
		cleanups.push(cleanup);
		await session.whenReady;

		await session.setCwd("~");
		expect(session.cwd).toBe(homedir());
	});

	it("rejects a non-existent path and leaves cwd unchanged", async () => {
		const { session, cleanup } = createTestSession();
		cleanups.push(cleanup);
		await session.whenReady;
		const before = session.cwd;

		await expect(session.setCwd(join(before, "does-not-exist-xyz"))).rejects.toThrow(/No such directory/);
		expect(session.cwd).toBe(before);
	});

	it("rejects a path that exists but is not a directory", async () => {
		const dir = freshDir();
		const filePath = join(dir, "a-file.txt");
		mkdirSync(dir, { recursive: true });
		// Create a regular file.
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, "x");
		const { session, cleanup } = createTestSession();
		cleanups.push(cleanup);
		await session.whenReady;
		const before = session.cwd;

		await expect(session.setCwd(filePath)).rejects.toThrow(/Not a directory/);
		expect(session.cwd).toBe(before);
	});
});

describe("CwdCommand.condition (#182)", () => {
	it("matches /cwd and /cd exactly and with an argument, not unrelated commands", async () => {
		const { CwdCommand } = await import("../src/modes/interactive/commands/cwd-command.js");
		const cmd = new CwdCommand();
		expect(cmd.condition("/cwd")).toBe(true);
		expect(cmd.condition("/cwd /tmp")).toBe(true);
		expect(cmd.condition("/cd")).toBe(true);
		expect(cmd.condition("/cd ~/src")).toBe(true);
		expect(cmd.condition("/cwdd")).toBe(false);
		expect(cmd.condition("/context")).toBe(false);
		expect(cmd.condition("/name foo")).toBe(false);
	});
});
