import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "../../config.js";
import { resolveCurrentCaveInvocation } from "../../utils/cave-invocation.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveCurrentCaveInvocation", () => {
	it("uses node + current script when argv[1] exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "cave-invocation-"));
		try {
			const script = join(dir, "cli.js");
			writeFileSync(script, "#!/usr/bin/env node\n");
			vi.spyOn(process, "argv", "get").mockReturnValue(["/usr/bin/node", script]);
			vi.spyOn(process, "execPath", "get").mockReturnValue("/usr/bin/node");

			expect(resolveCurrentCaveInvocation()).toEqual({
				command: "/usr/bin/node",
				argsPrefix: [script],
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses compiled binary directly when runtime is not generic", () => {
		vi.spyOn(process, "argv", "get").mockReturnValue(["/Applications/cave", "goal"]);
		vi.spyOn(process, "execPath", "get").mockReturnValue("/Applications/cave");

		expect(resolveCurrentCaveInvocation()).toEqual({
			command: "/Applications/cave",
			argsPrefix: [],
		});
	});

	it("falls back to configured app name when generic runtime has no script", () => {
		vi.spyOn(process, "argv", "get").mockReturnValue(["/usr/bin/node", "/missing/cli.js"]);
		vi.spyOn(process, "execPath", "get").mockReturnValue("/usr/bin/node");

		expect(resolveCurrentCaveInvocation()).toEqual({
			command: APP_NAME,
			argsPrefix: [],
		});
	});
});
