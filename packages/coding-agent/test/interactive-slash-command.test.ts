import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import {
	type InteractiveSlashCommandHandlers,
	InteractiveSlashCommandRouter,
} from "../src/modes/interactive/interactive-slash-command.js";

const SAMPLE_INPUTS: Record<string, string> = {
	help: "/help",
	settings: "/settings",
	model: "/model claude",
	"scoped-models": "/scoped-models",
	export: "/export session.html",
	import: "/import session.jsonl",
	share: "/share",
	copy: "/copy",
	name: "/name demo",
	session: "/session",
	changelog: "/changelog",
	hotkeys: "/hotkeys",
	activity: "/activity",
	fork: "/fork",
	tree: "/tree",
	login: "/login anthropic",
	logout: "/logout",
	new: "/new",
	clear: "/clear",
	compact: "/compact preserve decisions",
	freeze: "/freeze release-prep",
	checkpoints: "/checkpoints",
	mode: "/mode full",
	ponytail: "/ponytail ultra",
	resume: "/resume abc123",
	reload: "/reload",
	hooks: "/hooks list",
	mcp: "/mcp list",
	memory: "/memory status",
	repomap: "/repomap refresh",
	architect: "/architect on",
	recipe: "/recipe test",
	tokens: "/tokens",
	cost: "/cost",
	checkpoint: "/checkpoint before-edit",
	rollback: "/rollback list",
	savings: "/savings --report",
	goal: "/goal ship the feature",
	plan: "/plan investigate",
	act: "/act",
	approval: "/approval status",
	skills: "/skills",
	plugins: "/plugins",
	queue: "/queue clear",
	context: "/context setup code src",
	btw: "/btw what changed?",
	quit: "/quit",
};

function recordingHandlers(calls: string[]): InteractiveSlashCommandHandlers {
	return new Proxy(
		{
			setEditorText: (value: string) => {
				calls.push(`setEditorText:${value}`);
			},
		},
		{
			get(target, prop: string) {
				if (prop in target) return target[prop as keyof typeof target];
				return (...args: unknown[]) => calls.push(`${prop}:${args.map(String).join("|")}`);
			},
		},
	) as unknown as InteractiveSlashCommandHandlers;
}

function router(calls: string[] = []): InteractiveSlashCommandRouter {
	return new InteractiveSlashCommandRouter(recordingHandlers(calls));
}

describe("InteractiveSlashCommandRouter", () => {
	it("handles every wired built-in slash command", () => {
		const missing = BUILTIN_SLASH_COMMANDS.filter((command) => command.wired && !SAMPLE_INPUTS[command.name]).map(
			(command) => command.name,
		);
		expect(missing).toEqual([]);

		const r = router();
		const unhandled = BUILTIN_SLASH_COMMANDS.filter(
			(command) => command.wired && !r.canHandle(SAMPLE_INPUTS[command.name]),
		).map((command) => command.name);
		expect(unhandled).toEqual([]);
	});

	it("passes parsed arguments to handlers", async () => {
		const calls: string[] = [];
		const r = router(calls);

		expect(await r.handleCommand("/model claude")).toBe(true);
		expect(await r.handleCommand("/compact   keep decisions  ")).toBe(true);
		expect(await r.handleCommand("/freeze   release prep  ")).toBe(true);
		expect(await r.handleCommand("/queue clear")).toBe(true);
		expect(await r.handleCommand("/context setup docs docs/")).toBe(true);

		expect(calls).toContain("model:claude");
		expect(calls).toContain("compact:keep decisions");
		expect(calls).toContain("freeze:release prep");
		expect(calls).toContain("queue:clear");
		expect(calls).toContain("contextSetup:docs docs/");
	});

	it("keeps known aliases and legacy broad-prefix commands explicit", async () => {
		const calls: string[] = [];
		const r = router(calls);

		expect(await r.handleCommand("/clear")).toBe(true);
		expect(await r.handleCommand("/new")).toBe(true);
		expect(await r.handleCommand("/plugins")).toBe(true);
		expect(await r.handleCommand("/cave stats")).toBe(true);
		expect(await r.handleCommand("/exporter")).toBe(true);
		expect(await r.handleCommand("/import-foo")).toBe(true);

		expect(calls).toContain("clear:");
		expect(calls).toContain("skills:marketplace");
		expect(calls).toContain("caveMode:/cave stats");
		expect(calls).toContain("export:/exporter");
		expect(calls).toContain("import:/import-foo");
	});

	it("returns false for unknown or boundary-mismatched slash text", async () => {
		const r = router();
		for (const input of [
			"plain prompt",
			"",
			"/unknown-command",
			"/logout foo",
			"/new x",
			"/clear x",
			"/compactness",
			"/freeze-dry",
			"/loginx",
			"/some-extension",
		]) {
			expect(await r.handleCommand(input), input).toBe(false);
		}
	});

	it("preserves editor clearing order", async () => {
		const logoutCalls: string[] = [];
		expect(await router(logoutCalls).handleCommand("/logout")).toBe(true);
		expect(logoutCalls).toEqual(["logout:", "setEditorText:"]);

		const compactCalls: string[] = [];
		expect(await router(compactCalls).handleCommand("/compact keep decisions")).toBe(true);
		expect(compactCalls).toEqual(["setEditorText:", "compact:keep decisions"]);

		const loginCalls: string[] = [];
		expect(await router(loginCalls).handleCommand("/login anthropic")).toBe(true);
		expect(loginCalls).toEqual(["setEditorText:", "login:/login anthropic"]);
	});
});
