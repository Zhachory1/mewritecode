import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import { classifyInteractiveSlashCommand } from "../src/modes/interactive/interactive-slash-command.js";

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

describe("classifyInteractiveSlashCommand", () => {
	it("classifies every wired built-in slash command", () => {
		const missing = BUILTIN_SLASH_COMMANDS.filter((command) => command.wired && !SAMPLE_INPUTS[command.name]).map(
			(command) => command.name,
		);
		expect(missing).toEqual([]);

		for (const command of BUILTIN_SLASH_COMMANDS.filter((command) => command.wired)) {
			expect(classifyInteractiveSlashCommand(SAMPLE_INPUTS[command.name]), command.name).not.toBeNull();
		}
	});

	it("preserves parsed arguments for commands that need them", () => {
		expect(classifyInteractiveSlashCommand("/model claude")).toEqual({ kind: "model", searchTerm: "claude" });
		expect(classifyInteractiveSlashCommand("/compact   keep decisions  ")).toEqual({
			kind: "compact",
			instructions: "keep decisions",
		});
		expect(classifyInteractiveSlashCommand("/freeze   release prep  ")).toEqual({
			kind: "freeze",
			label: "release prep",
		});
		expect(classifyInteractiveSlashCommand("/queue clear")).toEqual({ kind: "queue", args: "clear" });
		expect(classifyInteractiveSlashCommand("/context setup docs docs/")).toEqual({
			kind: "context-setup",
			args: "docs docs/",
		});
	});

	it("keeps known aliases and legacy broad-prefix commands explicit", () => {
		expect(classifyInteractiveSlashCommand("/clear")).toEqual({ kind: "clear" });
		expect(classifyInteractiveSlashCommand("/new")).toEqual({ kind: "clear" });
		expect(classifyInteractiveSlashCommand("/plugins")).toEqual({ kind: "skills", mode: "marketplace" });
		expect(classifyInteractiveSlashCommand("/cave stats")).toEqual({ kind: "cave-mode", text: "/cave stats" });
		expect(classifyInteractiveSlashCommand("/exporter")).toEqual({ kind: "export", text: "/exporter" });
		expect(classifyInteractiveSlashCommand("/import-foo")).toEqual({ kind: "import", text: "/import-foo" });
	});

	it("returns null for unknown or boundary-mismatched slash text", () => {
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
			expect(classifyInteractiveSlashCommand(input), input).toBeNull();
		}
	});
});
