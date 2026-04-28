// WS3: tests for the SandboxPolicy IR, reducer, and command normalization.
import { describe, expect, it } from "vitest";
import {
	actionToAllowKey,
	buildSeatbeltProfileFromPolicy,
	defaultPolicyForMode,
	normalizeCommandKey,
	type PermissionStore,
	type ProposedAction,
	reduce,
	type SandboxPolicy,
	selectSandboxFromPolicy,
} from "../sandbox/index.js";

const STORE: PermissionStore = { alwaysAllow: [] };

const wsPolicy = (workdir = "/Users/cave/proj"): SandboxPolicy => ({
	kind: "workspace_write",
	workdir,
	extraWritableRoots: [],
	allowedHosts: [],
	allowAllNetwork: false,
});

describe("defaultPolicyForMode", () => {
	it("plan mode → read_only", () => {
		expect(defaultPolicyForMode("plan", "/x").kind).toBe("read_only");
	});
	it("bypassPermissions → danger_full_access", () => {
		expect(defaultPolicyForMode("bypassPermissions", "/x").kind).toBe("danger_full_access");
	});
	it("default/auto/acceptEdits → workspace_write", () => {
		for (const m of ["default", "auto", "acceptEdits"] as const) {
			expect(defaultPolicyForMode(m, "/x").kind).toBe("workspace_write");
		}
	});
});

describe("normalizeCommandKey", () => {
	it("collapses git subcommand variants to one key", () => {
		const k1 = normalizeCommandKey(["git", "status"]);
		const k2 = normalizeCommandKey(["git", "status", "-s"]);
		const k3 = normalizeCommandKey(["git", "status", "--porcelain"]);
		expect(k1).toBe(k2);
		expect(k2).toBe(k3);
		expect(k1).toContain("git status");
	});
	it("strips bin path on head verb", () => {
		expect(normalizeCommandKey(["/usr/bin/ls", "-la"])).toBe(normalizeCommandKey(["ls", "-la"]));
	});
	it("skips leading flags before subcommand for git family", () => {
		expect(normalizeCommandKey(["git", "--no-pager", "status"])).toBe(normalizeCommandKey(["git", "status"]));
	});
	it("npm/pnpm/yarn/cargo/docker pick subcommand", () => {
		expect(normalizeCommandKey(["npm", "install"])).toContain("npm install");
		expect(normalizeCommandKey(["docker", "run", "-it", "ubuntu"])).toContain("docker run");
		expect(normalizeCommandKey(["cargo", "build", "--release"])).toContain("cargo build");
	});
	it("non-subcommand binaries collapse to head + *", () => {
		expect(normalizeCommandKey(["ls", "-la"])).toBe("exec:ls -*");
	});
	it("returns stable key for empty argv", () => {
		expect(normalizeCommandKey([])).toBe("exec:");
	});
});

describe("actionToAllowKey", () => {
	it("normalizes path for read/edit", () => {
		expect(actionToAllowKey({ tier: "read", path: "/x/y/" })).toBe("read:/x/y");
		expect(actionToAllowKey({ tier: "edit", path: "/x/y" })).toBe("edit:/x/y");
	});
	it("lowercases host and includes port for net", () => {
		expect(actionToAllowKey({ tier: "network", host: "API.GitHub.com" })).toBe("net:api.github.com");
		expect(actionToAllowKey({ tier: "network", host: "x.com", port: 443 })).toBe("net:x.com:443");
	});
});

describe("reducer — bypassPermissions", () => {
	it("always allows", () => {
		const action: ProposedAction = { tier: "exec", command: "rm", argv: ["rm", "-rf", "/"] };
		const decision = reduce({ policy: wsPolicy(), mode: "bypassPermissions", action, store: STORE });
		expect(decision.kind).toBe("allow");
	});
});

describe("reducer — plan mode", () => {
	it("allows reads", () => {
		const decision = reduce({
			policy: wsPolicy(),
			mode: "plan",
			action: { tier: "read", path: "/Users/cave/proj/file.ts" },
			store: STORE,
		});
		expect(decision.kind).toBe("allow");
	});
	it("denies writes/exec/network", () => {
		for (const action of [
			{ tier: "edit", path: "/Users/cave/proj/x.ts" },
			{ tier: "exec", command: "ls", argv: ["ls"] },
			{ tier: "network", host: "x.com" },
		] as ProposedAction[]) {
			const decision = reduce({ policy: wsPolicy(), mode: "plan", action, store: STORE });
			expect(decision.kind).toBe("deny");
		}
	});
});

describe("reducer — workspace_write policy", () => {
	it("auto-allows edits inside workspace under acceptEdits", () => {
		const decision = reduce({
			policy: wsPolicy(),
			mode: "acceptEdits",
			action: { tier: "edit", path: "/Users/cave/proj/x.ts" },
			store: STORE,
		});
		expect(decision.kind).toBe("allow");
	});

	it("prompts edit-once for in-workspace edits under default mode", () => {
		const decision = reduce({
			policy: wsPolicy(),
			mode: "default",
			action: { tier: "edit", path: "/Users/cave/proj/x.ts" },
			store: STORE,
		});
		expect(decision.kind).toBe("prompt");
		if (decision.kind === "prompt") {
			expect(decision.defaultVerb).toBe("allow_once");
		}
	});

	it("defaults to deny verb for edits outside workspace", () => {
		const decision = reduce({
			policy: wsPolicy(),
			mode: "default",
			action: { tier: "edit", path: "/etc/passwd" },
			store: STORE,
		});
		expect(decision.kind).toBe("prompt");
		if (decision.kind === "prompt") {
			expect(decision.defaultVerb).toBe("deny");
		}
	});

	it("respects extra writable roots", () => {
		const policy: SandboxPolicy = {
			kind: "workspace_write",
			workdir: "/Users/cave/proj",
			extraWritableRoots: ["/tmp/scratch"],
			allowedHosts: [],
			allowAllNetwork: false,
		};
		const decision = reduce({
			policy,
			mode: "acceptEdits",
			action: { tier: "edit", path: "/tmp/scratch/file.txt" },
			store: STORE,
		});
		expect(decision.kind).toBe("allow");
	});

	it("auto-allows network for hosts on allowedHosts", () => {
		const policy: SandboxPolicy = {
			kind: "workspace_write",
			workdir: "/x",
			extraWritableRoots: [],
			allowedHosts: ["github.com", "*.github.com"],
			allowAllNetwork: false,
		};
		const okBare = reduce({
			policy,
			mode: "default",
			action: { tier: "network", host: "github.com" },
			store: STORE,
		});
		const okWild = reduce({
			policy,
			mode: "default",
			action: { tier: "network", host: "api.github.com" },
			store: STORE,
		});
		const blocked = reduce({
			policy,
			mode: "default",
			action: { tier: "network", host: "evil.com" },
			store: STORE,
		});
		expect(okBare.kind).toBe("allow");
		expect(okWild.kind).toBe("allow");
		expect(blocked.kind).toBe("prompt");
	});

	it("prompts exec with allow_once default and normalized key", () => {
		const decision = reduce({
			policy: wsPolicy(),
			mode: "default",
			action: { tier: "exec", command: "git", argv: ["git", "status", "-s"] },
			store: STORE,
		});
		expect(decision.kind).toBe("prompt");
		if (decision.kind === "prompt") {
			expect(decision.defaultVerb).toBe("allow_once");
			expect(decision.allowAlwaysKey).toBe("exec:git status -*");
		}
	});
});

describe("reducer — read_only policy", () => {
	it("allows reads, denies everything else", () => {
		const policy: SandboxPolicy = { kind: "read_only", workdir: "/x" };
		const ok = reduce({ policy, mode: "default", action: { tier: "read", path: "/x/a" }, store: STORE });
		expect(ok.kind).toBe("allow");
		const denyExec = reduce({
			policy,
			mode: "default",
			action: { tier: "exec", command: "ls", argv: ["ls"] },
			store: STORE,
		});
		expect(denyExec.kind).toBe("deny");
	});
});

describe("reducer — sensitive read prompt", () => {
	it("prompts with deny default for ~/.ssh, .aws, .env", () => {
		for (const path of ["/Users/x/.ssh/id_rsa", "/home/x/.aws/credentials", "/Users/x/proj/.env"]) {
			const decision = reduce({
				policy: wsPolicy(),
				mode: "default",
				action: { tier: "read", path },
				store: STORE,
			});
			expect(decision.kind).toBe("prompt");
			if (decision.kind === "prompt") {
				expect(decision.defaultVerb).toBe("deny");
			}
		}
	});
});

describe("reducer — allow-always store hits", () => {
	it("short-circuits to allow when key matches", () => {
		const store: PermissionStore = { alwaysAllow: ["exec:git status -*"] };
		const decision = reduce({
			policy: wsPolicy(),
			mode: "default",
			action: { tier: "exec", command: "git", argv: ["git", "status"] },
			store,
		});
		expect(decision.kind).toBe("allow");
	});
	it("variant-keyed allow-always covers all subcommand variants", () => {
		const store: PermissionStore = { alwaysAllow: ["exec:git status -*"] };
		for (const argv of [
			["git", "status"],
			["git", "status", "-s"],
			["git", "status", "--porcelain"],
		]) {
			const decision = reduce({
				policy: wsPolicy(),
				mode: "default",
				action: { tier: "exec", command: "git", argv },
				store,
			});
			expect(decision.kind).toBe("allow");
		}
	});
});

describe("buildSeatbeltProfileFromPolicy", () => {
	it("read_only → no `(allow file-write*` rules", () => {
		const policy: SandboxPolicy = { kind: "read_only", workdir: "/x" };
		const profile = buildSeatbeltProfileFromPolicy(policy);
		expect(profile).toContain("(deny default)");
		expect(profile).toContain("(deny network*)");
		// Sensitive-path denies will use file-write*, but no allows.
		expect(profile).not.toContain("(allow file-write*");
	});
	it("workspace_write writes to cwd, denies network by default", () => {
		const policy: SandboxPolicy = {
			kind: "workspace_write",
			workdir: "/Users/cave/proj",
			extraWritableRoots: ["/tmp/scratch"],
			allowedHosts: [],
			allowAllNetwork: false,
		};
		const profile = buildSeatbeltProfileFromPolicy(policy);
		expect(profile).toContain('(allow file-write* (subpath "/Users/cave/proj"))');
		expect(profile).toContain('(allow file-write* (subpath "/tmp/scratch"))');
		expect(profile).toContain("(deny network*)");
	});
	it("workspace_write + allowAllNetwork allows network", () => {
		const policy: SandboxPolicy = {
			kind: "workspace_write",
			workdir: "/x",
			extraWritableRoots: [],
			allowedHosts: [],
			allowAllNetwork: true,
		};
		expect(buildSeatbeltProfileFromPolicy(policy)).toContain("(allow network*)");
	});
	it("danger_full_access → (allow default)", () => {
		const profile = buildSeatbeltProfileFromPolicy({ kind: "danger_full_access", workdir: "/x" });
		expect(profile).toContain("(allow default)");
	});
});

describe("selectSandboxFromPolicy", () => {
	it("darwin uses seatbelt", () => {
		const sel = selectSandboxFromPolicy("darwin", "", { kind: "read_only", workdir: "/x" });
		expect(sel.sandbox.profile.kind).toBe("seatbelt");
	});
	it("danger_full_access reports as permissive across platforms", () => {
		const sel = selectSandboxFromPolicy("darwin", "", { kind: "danger_full_access", workdir: "/x" });
		expect(sel.sandbox.profile.kind).toBe("permissive");
	});
});
