// WS3: PermissionSession + on-disk allow-always store.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicyForMode, type PermissionMode, type ProposedAction } from "@cave/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendAlwaysAllow,
	cycleMode,
	getPermissionsPath,
	loadPermissionStore,
	PERMISSION_MODES,
	PermissionSession,
	type PromptOptions,
	type PromptUI,
} from "../permission-prompt.js";

class StubUI implements PromptUI {
	public lastOpts?: PromptOptions;
	constructor(private readonly answer: PromptOptions["defaultVerb"] | "deny" | "allow_session" | "allow_always") {}
	async chooseVerb(opts: PromptOptions) {
		this.lastOpts = opts;
		return this.answer;
	}
}

describe("PermissionSession", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "cave-permsess-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	const mkSession = (mode: PermissionMode, ui: PromptUI) =>
		new PermissionSession({ cwd: tmp, policy: defaultPolicyForMode(mode, tmp), mode, ui });

	it("auto-allows reads inside workspace_write without prompting", async () => {
		const ui = new StubUI("allow_once");
		const sess = mkSession("default", ui);
		const r = await sess.decide({ tier: "read", path: join(tmp, "x.ts") });
		expect(r.allowed).toBe(true);
		expect(ui.lastOpts).toBeUndefined();
	});

	it("denies writes/exec under plan mode without prompting", async () => {
		const ui = new StubUI("allow_once");
		const sess = mkSession("plan", ui);
		const action: ProposedAction = { tier: "exec", command: "ls", argv: ["ls"] };
		const r = await sess.decide(action);
		expect(r.allowed).toBe(false);
		expect(ui.lastOpts).toBeUndefined();
	});

	it("prompts exec under default mode with allow_once default verb", async () => {
		const ui = new StubUI("allow_once");
		const sess = mkSession("default", ui);
		const r = await sess.decide({ tier: "exec", command: "ls", argv: ["ls", "-la"] });
		expect(r.allowed).toBe(true);
		expect(ui.lastOpts?.defaultVerb).toBe("allow_once");
	});

	it("session-grant suppresses subsequent prompts in the same session", async () => {
		const ui = new StubUI("allow_session");
		const sess = mkSession("default", ui);
		const action: ProposedAction = { tier: "exec", command: "git", argv: ["git", "status"] };
		const r1 = await sess.decide(action);
		expect(r1.allowed).toBe(true);
		expect(r1.verb).toBe("allow_session");
		ui.lastOpts = undefined;
		const r2 = await sess.decide(action);
		expect(r2.allowed).toBe(true);
		expect(ui.lastOpts).toBeUndefined();
	});

	it("allow_always persists the normalized command key to .cave/permissions.json", async () => {
		const ui = new StubUI("allow_always");
		const sess = mkSession("default", ui);
		await sess.decide({ tier: "exec", command: "git", argv: ["git", "status", "-s"] });
		const path = getPermissionsPath(tmp);
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		expect(raw.alwaysAllow).toContain("exec:git status -*");
	});

	it("loads persisted allow-always so the next session skips prompts", async () => {
		appendAlwaysAllow(tmp, "exec:git status -*");
		const ui = new StubUI("deny"); // would deny if reached
		const sess = mkSession("default", ui);
		const r = await sess.decide({ tier: "exec", command: "git", argv: ["git", "status"] });
		expect(r.allowed).toBe(true);
		expect(ui.lastOpts).toBeUndefined();
	});
});

describe("loadPermissionStore", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "cave-store-"));
	});
	afterEach(() => rmSync(tmp, { recursive: true, force: true }));

	it("returns empty store when file is missing", () => {
		expect(loadPermissionStore(tmp).alwaysAllow).toEqual([]);
	});
	it("filters non-string entries on read", () => {
		appendAlwaysAllow(tmp, "exec:ls -*");
		const path = getPermissionsPath(tmp);
		const tampered = { alwaysAllow: ["exec:ls -*", 42, null, "exec:cat -*"] };
		require("node:fs").writeFileSync(path, JSON.stringify(tampered), "utf-8");
		const loaded = loadPermissionStore(tmp);
		expect(loaded.alwaysAllow).toEqual(["exec:ls -*", "exec:cat -*"]);
	});
});

describe("cycleMode", () => {
	it("cycles through all 5 modes in order", () => {
		let mode: PermissionMode = "default";
		const seen: PermissionMode[] = [mode];
		for (let i = 0; i < PERMISSION_MODES.length; i++) {
			mode = cycleMode(mode);
			seen.push(mode);
		}
		// After 5 cycles we should be back to "default".
		expect(seen[seen.length - 1]).toBe("default");
		expect(new Set(seen.slice(0, 5))).toEqual(new Set(PERMISSION_MODES));
	});
});
