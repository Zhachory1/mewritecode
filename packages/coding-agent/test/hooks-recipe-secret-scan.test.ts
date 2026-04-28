/**
 * End-to-end test for the bundled `secret-scan.sh` PreToolUse recipe.
 *
 * Validates the pattern recommended in the v2 master plan §6 WS4:
 * a Write tool call with high-confidence secret content is denied
 * by exit-2 + permissionDecision=deny.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HooksManager } from "../src/core/hooks/index.js";

const skipOnWindows = process.platform === "win32" ? it.skip : it;
// python3 is required by all four recipes for stdin parsing; skip on machines without it.
const hasPython = (() => {
	try {
		const { execSync } = require("node:child_process");
		execSync("python3 --version", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();
const maybeIt = hasPython ? skipOnWindows : it.skip;

const RECIPE_PATH = resolve(__dirname, "..", "src", "core", "hooks", "recipes", "secret-scan.sh");

describe("secret-scan.sh recipe", () => {
	maybeIt(
		"denies a Write that contains an AWS access key",
		async () => {
			const manager = new HooksManager({
				cwd: () => process.cwd(),
				projectDir: () => process.cwd(),
				sessionId: () => "test",
			});
			manager.registry.setLayer("project", {
				PreToolUse: [
					{
						matcher: "Write|Edit",
						hooks: [{ type: "command", command: RECIPE_PATH, timeout: 5 }],
					},
				],
			});

			const result = await manager.dispatch("PreToolUse", "Write", {
				tool_name: "Write",
				tool_input: {
					file_path: "/tmp/secret.txt",
					content: "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n", // matches AKIA[A-Z0-9]{16}
				},
			} as any);

			expect(result.permission).toBe("deny");
			expect(result.results).toHaveLength(1);
			expect(result.results[0].exitCode).toBe(2);
		},
		15000,
	);

	maybeIt(
		"allows a Write with no secret-shaped content",
		async () => {
			const manager = new HooksManager({
				cwd: () => process.cwd(),
				projectDir: () => process.cwd(),
				sessionId: () => "test",
			});
			manager.registry.setLayer("project", {
				PreToolUse: [
					{
						matcher: "Write|Edit",
						hooks: [{ type: "command", command: RECIPE_PATH, timeout: 5 }],
					},
				],
			});

			const result = await manager.dispatch("PreToolUse", "Write", {
				tool_name: "Write",
				tool_input: {
					file_path: "/tmp/note.txt",
					content: "this file is just plain text, no secrets here",
				},
			} as any);

			expect(result.permission).toBeUndefined();
			expect(result.results[0].exitCode).toBe(0);
		},
		15000,
	);

	maybeIt("does not run for unrelated tool names", async () => {
		const manager = new HooksManager({
			cwd: () => process.cwd(),
			projectDir: () => process.cwd(),
			sessionId: () => "test",
		});
		manager.registry.setLayer("project", {
			PreToolUse: [
				{
					matcher: "Write|Edit",
					hooks: [{ type: "command", command: RECIPE_PATH, timeout: 5 }],
				},
			],
		});
		const result = await manager.dispatch("PreToolUse", "Bash", {
			tool_name: "Bash",
			tool_input: { command: "ls" },
		} as any);
		expect(result.results).toHaveLength(0);
	});
});
