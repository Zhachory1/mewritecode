import { Container, type Terminal, TUI, visibleWidth } from "@zhachory1/mewrite-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { VERSION } from "../src/config.js";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import {
	detailOf,
	formatProviderChoices,
	kindOf,
	labelOf,
	parseLoginCommand,
} from "../src/modes/interactive/activity-helpers.js";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.js";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

class FakeTerminal implements Terminal {
	columns = 80;
	rows = 24;
	kittyProtocolActive = true;

	start(): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(_data: string): void {}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	enterAltScreen(): void {}
	leaveAltScreen(): void {}
	enableMouseTracking(): void {}
	disableMouseTracking(): void {}
	isTTY(): boolean {
		return false;
	}
	async queryOsc(_sequence: string, _responsePrefix: string, _timeoutMs: number): Promise<string | null> {
		return null;
	}
}

describe("InteractiveMode onboarding affordances", () => {
	const providers = [
		{ id: "anthropic", aliases: ["claude"] },
		{ id: "openai-codex", aliases: ["chatgpt", "openai", "codex"] },
		{ id: "google-gemini-cli", aliases: ["gemini", "google"] },
		{ id: "github-copilot", aliases: ["copilot", "github"] },
	];

	beforeAll(() => {
		initTheme("dark");
	});

	test("resolves friendly /login aliases to provider ids", () => {
		expect(parseLoginCommand("/login claude", providers)).toEqual({ kind: "provider", provider: "anthropic" });
		expect(parseLoginCommand("/login chatgpt", providers)).toEqual({ kind: "provider", provider: "openai-codex" });
		expect(parseLoginCommand("/login gemini", providers)).toEqual({
			kind: "provider",
			provider: "google-gemini-cli",
		});
		expect(parseLoginCommand("/login copilot", providers)).toEqual({
			kind: "provider",
			provider: "github-copilot",
		});
	});

	test("continues to accept raw provider ids", () => {
		expect(parseLoginCommand("/login anthropic", providers)).toEqual({ kind: "provider", provider: "anthropic" });
		expect(parseLoginCommand("/login openai-codex", providers)).toEqual({
			kind: "provider",
			provider: "openai-codex",
		});
		expect(parseLoginCommand("/login google-gemini-cli", providers)).toEqual({
			kind: "provider",
			provider: "google-gemini-cli",
		});
		expect(parseLoginCommand("/login github-copilot", providers)).toEqual({
			kind: "provider",
			provider: "github-copilot",
		});
	});

	test("lists raw provider ids and friendly aliases for invalid provider errors", () => {
		const choices = formatProviderChoices(providers);

		expect(choices).toContain("anthropic (claude)");
		expect(choices).toContain("openai-codex (chatgpt, openai, codex)");
		expect(choices).toContain("google-gemini-cli (gemini, google)");
		expect(choices).toContain("github-copilot (copilot, github)");
	});

	test("registers /help and /activity as wired built-in commands", () => {
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "help",
			description: "Show commands and keyboard shortcuts",
			wired: true,
		});
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "activity",
			description: "Toggle live activity monitor",
			wired: true,
		});
	});

	test("custom editor renders the first-run placeholder without changing text", () => {
		const editor = new CustomEditor(new TUI(new FakeTerminal()), getEditorTheme(), KeybindingsManager.create(), {
			placeholder: "Type a task, or / for commands · F1 help",
		});
		editor.focused = true;

		const output = editor.render(80).join("\n");

		expect(output).toContain("ype a task, or / for commands · F1 help");
		expect(output).toContain("\x1b[2m");
		expect(editor.getText()).toBe("");
		for (const line of editor.render(80)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		}
	});
});

describe("InteractiveMode activity helpers", () => {
	test("classifies MCP tools separately from generic tools", () => {
		expect(kindOf("mcp_tool_call")).toBe("mcp");
		expect(kindOf("mcp_tool_search")).toBe("mcp");
		expect(labelOf("mcp_tool_call", {})).toBe("mcp call");
		expect(labelOf("mcp_tool_search", {})).toBe("mcp search");
		expect(detailOf("mcp_tool_call", { name: "mcp__github__search" })).toBe("mcp__github__search");
		expect(detailOf("mcp_tool_search", { query: "repo logs" })).toBe("repo logs");
	});

	test("extracts bash PID from partial activity updates", () => {
		const fakeThis: any = {};
		const pid = (InteractiveMode as any).prototype.extractBashPid.call(fakeThis, { details: { pid: 12345 } });

		expect(pid).toBe(12345);
	});
});

describe("InteractiveMode startup changelog", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("does not show changelog on startup by default but records current version", () => {
		const setLastChangelogVersion = vi.fn();
		const fakeThis: any = {
			session: { state: { messages: [] } },
			settingsManager: {
				getLastChangelogVersion: () => "0.0.0",
				getShowChangelogOnStartup: () => false,
				setLastChangelogVersion,
			},
		};

		const changelog = (InteractiveMode as any).prototype.getChangelogForDisplay.call(fakeThis);

		expect(changelog).toBeUndefined();
		expect(setLastChangelogVersion).toHaveBeenCalledWith(VERSION);
	});

	test("renders condensed startup changelog only when markdown is provided", () => {
		const fakeThis: any = {
			startupNoticesShown: false,
			changelogMarkdown: "## [1.2.3] - 2026-01-01\n\n### Added\n\n- Example",
			version: "1.2.3",
			chatContainer: new Container(),
			settingsManager: { getCollapseChangelog: () => true },
			getMarkdownThemeWithSettings: () => ({}),
		};

		(InteractiveMode as any).prototype.showStartupNoticesIfNeeded.call(fakeThis);
		const output = renderAll(fakeThis.chatContainer);

		expect(output).toContain("Updated to v1.2.3");
		expect(output).toContain("/changelog");
		expect(output).not.toContain("What's New");
	});
});

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.showLoadedResources", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowLoadedResourcesThis(options: {
		quietStartup: boolean;
		quietResourceListing?: boolean;
		verbose?: boolean;
		skills?: Array<{ filePath: string }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
	}) {
		const fakeThis: any = {
			options: { verbose: options.verbose ?? false },
			chatContainer: new Container(),
			settingsManager: {
				getQuietStartup: () => options.quietStartup,
				getQuietResourceListing: () => options.quietResourceListing ?? true,
			},
			session: {
				promptTemplates: [],
				extensionRunner: undefined,
				resourceLoader: {
					getPathMetadata: () => new Map(),
					getAgentsFiles: () => ({ agentsFiles: [] }),
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getExtensions: () => ({ extensions: [], errors: [], runtime: {} }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
				},
			},
			formatDisplayPath: (p: string) => p,
			buildScopeGroups: () => [],
			formatScopeGroups: () => "resource-list",
			getShortPath: (p: string) => p,
			formatDiagnostics: () => "diagnostics",
			getBuiltInCommandConflictDiagnostics: () => [],
		};

		return fakeThis;
	}

	test("does not show verbose listing on quiet startup during reload", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			extensions: [{ path: "/tmp/ext/index.ts" }],
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		expect(fakeThis.chatContainer.children).toHaveLength(0);
	});

	test("does not print the full startup skills list even in verbose resource output", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: false,
			quietResourceListing: false,
			verbose: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		const output = renderAll(fakeThis.chatContainer);
		expect(output).not.toContain("[Skills]");
		expect(output).not.toContain("resource-list");
	});

	test("still shows diagnostics on quiet startup when requested", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		const output = renderAll(fakeThis.chatContainer);
		expect(output).toContain("[Skill conflicts]");
		expect(output).not.toContain("[Skills]");
	});
});
