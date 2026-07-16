import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import {
	createDefaultInteractiveSlashCommands,
	type InteractiveSlashCommandContext,
	InteractiveSlashCommandRouter,
} from "../src/modes/interactive/commands/index.js";

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

function recordingHandlers(calls: string[]): InteractiveSlashCommandContext {
	const legacy = new Proxy(
		{},
		{
			get(_target, prop: string) {
				return (...args: unknown[]) => calls.push(`${prop}:${args.map(String).join("|")}`);
			},
		},
	) as InteractiveSlashCommandContext["legacy"];
	let commandQueue = ["/first", "/second"];
	return {
		editor: {
			setText: (value: string) => {
				calls.push(`setEditorText:${value}`);
			},
		},
		ui: { requestRender: () => calls.push("requestRender:") } as never,
		chatContainer: {
			addChild: (value: unknown) => calls.push(`chatContainer.addChild:${value?.constructor?.name ?? "unknown"}`),
		} as never,
		statusContainer: { clear: () => calls.push("statusContainer.clear:") } as never,
		session: {
			chatMode: "edit",
			sessionId: "session-1",
			approvalMode: false,
			isStreaming: true,
			compact: async (instructions?: string) => calls.push(`session.compact:${instructions ?? ""}`),
			prompt: async (prompt: string, options?: { streamingBehavior?: string }) =>
				calls.push(`session.prompt:${prompt}:${options?.streamingBehavior ?? ""}`),
			setChatMode: (mode: string) => calls.push(`session.setChatMode:${mode}`),
			setApprovalMode: (enabled: boolean) => calls.push(`session.setApprovalMode:${enabled}`),
			getContextEngineStatusLines: () => ["ContextEngine: enabled"],
			getCaveModeSessionState: () => ({ enabled: true, intensity: "full" }),
			getPonytailSessionState: () => ({ enabled: true, intensity: "full" }),
			getLastAssistantText: () => "",
			getSessionStats: () => ({
				tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
				cost: 0.01,
				contextUsage: undefined,
			}),
			setCaveModeSessionIntensity: (value: string) => calls.push(`session.setCaveModeSessionIntensity:${value}`),
			setCaveModeSessionDisabled: () => calls.push("session.setCaveModeSessionDisabled:"),
			setPonytailSessionIntensity: (value: string) => calls.push(`session.setPonytailSessionIntensity:${value}`),
			setPonytailSessionDisabled: () => calls.push("session.setPonytailSessionDisabled:"),
		} as never,
		sessionManager: {
			getCwd: () => "/repo",
			getEntries: () => [{ type: "message" }, { type: "message" }],
		} as never,
		settingsManager: {
			getContextSetupSettings: () => ({}),
			setContextSetupSettings: (value: unknown) =>
				calls.push(`settings.setContextSetupSettings:${JSON.stringify(value)}`),
			getCaveModeIntensity: () => "full",
			getCaveModeToolCompression: () => true,
			getPonytailIntensity: () => "full",
		} as never,
		freezeCheckpoints: [],
		getCommandQueue: () => commandQueue,
		clearCommandQueue: () => {
			const count = commandQueue.length;
			commandQueue = [];
			return count;
		},
		repomapChatState: {} as never,
		getArchitectState: () => ({}) as never,
		setArchitectState: (value) => calls.push(`setArchitectState:${JSON.stringify(value)}`),
		updatePendingMessagesDisplay: () => calls.push("updatePendingMessagesDisplay:"),
		stopLoadingAndClearStatus: () => calls.push("stopLoadingAndClearStatus:"),
		buildHotkeysMarkdown: () => "hotkeys",
		getMarkdownTheme: () => ({}) as never,
		appendSlashOutput: (text, isError) => calls.push(`appendSlashOutput:${isError}:${text}`),
		refreshChatModeFooter: () => calls.push("refreshChatModeFooter:"),
		refreshApprovalFooter: () => calls.push("refreshApprovalFooter:"),
		showError: (message) => calls.push(`showError:${message}`),
		showStatus: (message) => calls.push(`showStatus:${message}`),
		showWarning: (message) => calls.push(`showWarning:${message}`),
		updateTerminalTitle: () => calls.push("updateTerminalTitle:"),
		legacy,
	};
}

function router(calls: string[] = []): InteractiveSlashCommandRouter {
	return new InteractiveSlashCommandRouter(recordingHandlers(calls), createDefaultInteractiveSlashCommands());
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
		expect(calls).toContain("session.compact:keep decisions");
		expect(calls.some((call) => call.startsWith("session.compact:Only preserve:"))).toBe(true);
		expect(calls).toContain("updatePendingMessagesDisplay:");
		expect(calls.some((call) => call.includes("Cleared 2 queued commands"))).toBe(true);
		expect(calls.some((call) => call.includes("Unknown /context setup subcommand: docs"))).toBe(true);
	});

	it("runs plan, act, approval, and context command bodies through context primitives", async () => {
		const calls: string[] = [];
		const r = router(calls);

		expect(await r.handleCommand("/plan investigate auth")).toBe(true);
		expect(await r.handleCommand("/act ship it")).toBe(true);
		expect(await r.handleCommand("/approval on")).toBe(true);
		expect(await r.handleCommand("/context status")).toBe(true);
		expect(await r.handleCommand("/context learn")).toBe(true);
		expect(await r.handleCommand("/context setup skip")).toBe(true);

		expect(calls).toContain("session.setChatMode:plan");
		expect(calls.some((call) => call.startsWith("session.prompt:investigate auth:steer"))).toBe(true);
		expect(calls.some((call) => call.startsWith("appendSlashOutput:false:"))).toBe(true);
		expect(calls.some((call) => call.includes("ContextEngine: enabled"))).toBe(true);
		expect(calls.some((call) => call.includes("settings.setContextSetupSettings"))).toBe(true);
		expect(calls).toContain("refreshChatModeFooter:");
		expect(calls).toContain("refreshApprovalFooter:");
	});

	it("keeps known aliases and legacy broad-prefix commands explicit", async () => {
		const calls: string[] = [];
		const r = router(calls);

		expect(await r.handleCommand("/clear")).toBe(true);
		expect(await r.handleCommand("/new")).toBe(true);
		expect(await r.handleCommand("/plugins")).toBe(true);
		expect(r.canHandle("/cave stats")).toBe(true);
		expect(await r.handleCommand("/exporter")).toBe(true);
		expect(await r.handleCommand("/import-foo")).toBe(true);

		expect(calls).toContain("clear:");
		expect(calls).toContain("plugins:");
		expect(r.canHandle("/mode full")).toBe(true);
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
		expect(compactCalls).toEqual(["setEditorText:", "stopLoadingAndClearStatus:", "session.compact:keep decisions"]);

		const loginCalls: string[] = [];
		expect(await router(loginCalls).handleCommand("/login anthropic")).toBe(true);
		expect(loginCalls).toEqual(["setEditorText:", "login:/login anthropic"]);
	});

	it("uses live queue accessors instead of a captured queue reference", async () => {
		const calls: string[] = [];
		const r = router(calls);
		expect(await r.handleCommand("/queue clear")).toBe(true);
		expect(await r.handleCommand("/queue")).toBe(true);
		expect(calls.some((call) => call.includes("Cleared 2 queued commands"))).toBe(true);
		expect(calls.some((call) => call.includes("Queue is empty"))).toBe(true);
	});

	it("clears the editor before reporting that /copy has no assistant message", async () => {
		const calls: string[] = [];
		expect(await router(calls).handleCommand("/copy")).toBe(true);
		expect(calls.slice(0, 2)).toEqual(["setEditorText:", "showError:No agent messages to copy yet."]);
	});
});
