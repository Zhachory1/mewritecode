// WS3: parser + dry-run for `cave sandbox -- <cmd>`.
import { describe, expect, it } from "vitest";
import { buildPolicyForRun, parseSandboxCliArgs, runSandboxCommand } from "../slash-commands/sandbox.js";

describe("parseSandboxCliArgs", () => {
	it("splits on -- to separate cave flags from the user command", () => {
		const args = parseSandboxCliArgs(["--mode=plan", "--", "echo", "hi"]);
		expect(args.mode).toBe("plan");
		expect(args.command).toEqual(["echo", "hi"]);
	});
	it("collects --allow-host repeatedly", () => {
		const args = parseSandboxCliArgs(["--allow-host=github.com", "--allow-host=*.npmjs.org", "--", "npm", "install"]);
		expect(args.allowedHosts).toEqual(["github.com", "*.npmjs.org"]);
	});
	it("treats positional args before -- as the command", () => {
		const args = parseSandboxCliArgs(["echo", "hi"]);
		expect(args.command).toEqual(["echo", "hi"]);
	});
	it("recognises --dry-run, --allow-net, --extra-write", () => {
		const args = parseSandboxCliArgs(["--dry-run", "--allow-net", "--extra-write=/tmp/scratch", "--", "true"]);
		expect(args.dryRun).toBe(true);
		expect(args.allowAllNetwork).toBe(true);
		expect(args.extraWritableRoots).toEqual(["/tmp/scratch"]);
	});
	it("--help short-circuits", () => {
		expect(parseSandboxCliArgs(["--help"]).help).toBe(true);
	});
});

describe("buildPolicyForRun", () => {
	it("default mode → workspace_write with overrides applied", () => {
		const policy = buildPolicyForRun({
			mode: "default",
			workdir: "/x",
			allowedHosts: ["github.com"],
			extraWritableRoots: ["/tmp/a"],
		});
		expect(policy.kind).toBe("workspace_write");
		if (policy.kind === "workspace_write") {
			expect(policy.allowedHosts).toEqual(["github.com"]);
			expect(policy.extraWritableRoots).toEqual(["/tmp/a"]);
		}
	});
	it("plan mode forces read_only regardless of overrides", () => {
		const policy = buildPolicyForRun({ mode: "plan", workdir: "/x", allowedHosts: ["github.com"] });
		expect(policy.kind).toBe("read_only");
	});
});

describe("runSandboxCommand dry-run", () => {
	it("emits a sandbox-exec wrapper on darwin with workspace_write", () => {
		const result = runSandboxCommand("echo hi", { dryRun: true, mode: "default", workdir: "/tmp" });
		expect(result.exitCode).toBe(0);
		if (process.platform === "darwin") {
			expect(result.wrappedCommand).toMatch(/^sandbox-exec /);
			expect(result.wrappedCommand).toContain("echo hi");
		}
	});
	it("danger_full_access wraps with the (allow default) profile on darwin", () => {
		const result = runSandboxCommand("echo bypass", {
			dryRun: true,
			mode: "bypassPermissions",
			workdir: "/tmp",
		});
		if (process.platform === "darwin") {
			expect(result.wrappedCommand).toContain("(allow default)");
		}
	});
});
