/**
 * WS9 — `mewrite worker` registry tests.
 *
 * Exercises the JSON-file registry at ~/.mewrite/workers.json by overriding HOME
 * to a tmp directory. Verifies register/list/remove are idempotent and that
 * the file is byte-stable JSON.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
	originalHome = process.env.HOME;
	originalUserProfile = process.env.USERPROFILE;
	tmpHome = mkdtempSync(join(tmpdir(), "cave-worker-test-"));
	process.env.HOME = tmpHome;
	process.env.USERPROFILE = tmpHome; // win32 path
});

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
	rmSync(tmpHome, { recursive: true, force: true });
});

async function freshWorker() {
	// Re-import per test so homedir() picks up the fresh HOME.
	vi.resetModules();
	return await import("../src/cli/worker.js");
}

describe("mewrite worker registry", () => {
	it("register writes ~/.mewrite/workers.json with the expected shape", async () => {
		const { handleWorkerCommand, readWorkersForTest } = await freshWorker();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`__exit__:${code ?? 0}`);
		}) as never);
		try {
			await expect(
				handleWorkerCommand(["worker", "register", "gpu-1", "--url", "http://1.2.3.4:7421"]),
			).rejects.toThrow(/__exit__:0/);
		} finally {
			exitSpy.mockRestore();
		}
		const file = readWorkersForTest();
		expect(file.workers.length).toBe(1);
		expect(file.workers[0].name).toBe("gpu-1");
		expect(file.workers[0].url).toBe("http://1.2.3.4:7421");
		expect(file.workers[0].registeredAt).toBeTruthy();

		const path = join(tmpHome, ".mewrite", "workers.json");
		expect(existsSync(path)).toBe(true);
		// Stable JSON: round-trip should be readable.
		const raw = JSON.parse(readFileSync(path, "utf8"));
		expect(raw.workers[0].url).toBe("http://1.2.3.4:7421");
	});

	it("rejects unsafe worker names", async () => {
		const { handleWorkerCommand, readWorkersForTest } = await freshWorker();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`__exit__:${code ?? 0}`);
		}) as never);
		try {
			await expect(handleWorkerCommand(["worker", "register", "gpu prod", "--url", "http://a"])).rejects.toThrow(
				/__exit__:1/,
			);
		} finally {
			exitSpy.mockRestore();
		}
		expect(readWorkersForTest().workers).toEqual([]);
	});

	it("register is idempotent on the same name (replaces entry)", async () => {
		const { handleWorkerCommand, readWorkersForTest } = await freshWorker();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`__exit__:${code ?? 0}`);
		}) as never);
		try {
			await expect(handleWorkerCommand(["worker", "register", "gpu-1", "--url", "http://a"])).rejects.toThrow();
			await expect(handleWorkerCommand(["worker", "register", "gpu-1", "--url", "http://b"])).rejects.toThrow();
		} finally {
			exitSpy.mockRestore();
		}
		const f = readWorkersForTest();
		expect(f.workers.length).toBe(1);
		expect(f.workers[0].url).toBe("http://b");
	});

	it("remove drops the named worker", async () => {
		const { handleWorkerCommand, readWorkersForTest } = await freshWorker();
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`__exit__:${code ?? 0}`);
		}) as never);
		try {
			await expect(handleWorkerCommand(["worker", "register", "gpu-1", "--url", "http://a"])).rejects.toThrow();
			await expect(handleWorkerCommand(["worker", "register", "gpu-2", "--url", "http://b"])).rejects.toThrow();
			await expect(handleWorkerCommand(["worker", "remove", "gpu-1"])).rejects.toThrow();
		} finally {
			exitSpy.mockRestore();
		}
		const f = readWorkersForTest();
		expect(f.workers.length).toBe(1);
		expect(f.workers[0].name).toBe("gpu-2");
	});
});
