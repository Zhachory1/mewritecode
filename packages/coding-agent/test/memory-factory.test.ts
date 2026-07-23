import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { resetMemoryProviderCache, resolveMemoryProvider } from "../src/core/memory-factory.js";

class FakeChild extends EventEmitter {
	stdin = { write: () => true, end: () => undefined };
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill = () => true;
}

function probeSpawn(exitCode: number, calls: string[][]): typeof spawn {
	return ((_: string, args: string[]) => {
		calls.push(args);
		const child = new FakeChild();
		queueMicrotask(() => child.emit("close", exitCode));
		return child as unknown as ReturnType<typeof spawn>;
	}) as unknown as typeof spawn;
}

afterEach(() => {
	resetMemoryProviderCache();
});

describe("resolveMemoryProvider", () => {
	it("defaults to Cavemem and probes it before use", async () => {
		const calls: string[][] = [];
		const provider = await resolveMemoryProvider({
			cwd: "/tmp/memory-factory-cavemem",
			cavememOptions: { spawnImpl: probeSpawn(0, calls) },
		});

		expect(provider.id).toBe("cavemem");
		expect(calls).toEqual([["--version"]]);
	});

	it("falls back to FilesProvider when Cavemem probe fails", async () => {
		const calls: string[][] = [];
		const provider = await resolveMemoryProvider({
			cwd: "/tmp/memory-factory-fallback",
			cavememOptions: { spawnImpl: probeSpawn(127, calls) },
		});

		expect(provider.id).toBe("files");
		expect(calls).toEqual([["--version"]]);
	});

	it("uses FilesProvider without probing Cavemem when explicitly configured", async () => {
		const calls: string[][] = [];
		const provider = await resolveMemoryProvider({
			cwd: "/tmp/memory-factory-files",
			settings: {
				enabled: true,
				backend: "files",
				capture: { requirePreview: true },
				retrieval: { enabled: true, maxResults: 5 },
			},
			cavememOptions: { spawnImpl: probeSpawn(0, calls) },
		});

		expect(provider.id).toBe("files");
		expect(calls).toEqual([]);
	});
});
