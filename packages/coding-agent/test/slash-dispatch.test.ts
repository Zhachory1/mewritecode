import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import {
	createDefaultInteractiveSlashCommands,
	type InteractiveSlashCommandContext,
	InteractiveSlashCommandRouter,
} from "../src/modes/interactive/commands/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const interactiveModePath = resolve(here, "../src/modes/interactive/interactive-mode.ts");
const SOURCE = readFileSync(interactiveModePath, "utf-8");

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

const noopHandlers: InteractiveSlashCommandContext = {
	editor: { setText: () => {} },
	ui: { requestRender: () => {} } as never,
	chatContainer: { addChild: () => {} } as never,
	statusContainer: { clear: () => {} } as never,
	session: {} as never,
	sessionManager: {} as never,
	settingsManager: {} as never,
	freezeCheckpoints: [],
	stopLoadingAndClearStatus: () => {},
	buildHotkeysMarkdown: () => "",
	getMarkdownTheme: () => ({}) as never,
	showError: () => {},
	showStatus: () => {},
	showWarning: () => {},
	updateTerminalTitle: () => {},
	legacy: new Proxy(
		{},
		{
			get() {
				return () => {};
			},
		},
	) as InteractiveSlashCommandContext["legacy"],
};

describe("slash command dispatcher", () => {
	it("every BUILTIN_SLASH_COMMAND is handled by the interactive router", () => {
		const missingSamples = BUILTIN_SLASH_COMMANDS.filter((cmd) => cmd.wired && !SAMPLE_INPUTS[cmd.name]).map(
			(cmd) => cmd.name,
		);
		expect(missingSamples).toEqual([]);

		const router = new InteractiveSlashCommandRouter(noopHandlers, createDefaultInteractiveSlashCommands());
		const unhandled = BUILTIN_SLASH_COMMANDS.filter(
			(cmd) => cmd.wired && !router.canHandle(SAMPLE_INPUTS[cmd.name]),
		).map((cmd) => cmd.name);
		expect(unhandled).toEqual([]);
	});

	it("dispatcher has an unknown-slash fallback that flags unwired built-ins", () => {
		expect(SOURCE).toMatch(/isUnwiredBuiltinSlash/);
	});
});
