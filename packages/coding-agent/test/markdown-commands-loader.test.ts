/**
 * WS5: markdown slash-command discovery loader.
 *
 * Validates project + user + bundled-defaults discovery, frontmatter
 * passthrough, name-collision precedence, and the live filesystem watcher.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { expandMarkdownCommand, loadMarkdownCommands, watchMarkdownCommands } from "../src/core/slash-commands.js";

describe("WS5 slash-commands — discovery loader", () => {
	let cwd: string;
	let agentDir: string;
	let bundledDir: string;
	let projectDir: string;
	let userDir: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "cave-cmd-cwd-"));
		agentDir = mkdtempSync(join(tmpdir(), "cave-cmd-agent-"));
		bundledDir = mkdtempSync(join(tmpdir(), "cave-cmd-bundled-"));
		projectDir = join(cwd, ".cave", "commands");
		userDir = join(agentDir, "commands");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(userDir, { recursive: true });
	});
	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(bundledDir, { recursive: true, force: true });
	});

	it("loads commands from project, user, and bundled-defaults dirs", () => {
		writeFileSync(join(projectDir, "p1.md"), "---\nname: p1\ndescription: from project\n---\nbody-p1", "utf-8");
		writeFileSync(join(userDir, "u1.md"), "---\nname: u1\ndescription: from user\n---\nbody-u1", "utf-8");
		writeFileSync(join(bundledDir, "b1.md"), "---\nname: b1\ndescription: from bundled\n---\nbody-b1", "utf-8");

		const { commands, diagnostics } = loadMarkdownCommands({
			cwd,
			agentDir,
			defaultsDir: bundledDir,
		});

		const collisions = diagnostics.filter((d) => d.type === "collision");
		expect(collisions).toEqual([]);
		const names = commands.map((c) => c.name).sort();
		expect(names).toEqual(["b1", "p1", "u1"]);
	});

	it("prefers project over user over bundled defaults on collision", () => {
		// Same command name, different bodies. Project should win.
		writeFileSync(
			join(projectDir, "shared.md"),
			"---\nname: shared\ndescription: project-version\n---\nproject",
			"utf-8",
		);
		writeFileSync(join(userDir, "shared.md"), "---\nname: shared\ndescription: user-version\n---\nuser", "utf-8");
		writeFileSync(
			join(bundledDir, "shared.md"),
			"---\nname: shared\ndescription: bundled-version\n---\nbundled",
			"utf-8",
		);

		const { commands, diagnostics } = loadMarkdownCommands({
			cwd,
			agentDir,
			defaultsDir: bundledDir,
		});
		const shared = commands.find((c) => c.name === "shared");
		expect(shared).toBeDefined();
		expect(shared!.description).toBe("project-version");
		expect(shared!.body.trim()).toBe("project");
		// Two collisions reported (user + bundled losing to project).
		expect(diagnostics.filter((d) => d.type === "collision").length).toBe(2);
	});

	it("parses the full Claude Code frontmatter superset", () => {
		writeFileSync(
			join(projectDir, "fancy.md"),
			[
				"---",
				"name: fancy",
				"description: A fancy command",
				'argument-hint: "<file> [extra]"',
				"allowed-tools:",
				"  - bash",
				"  - read",
				"model: claude-3-5-sonnet-latest",
				"effort: high",
				"context: fork",
				"agent: .cave/agents/critic.md",
				"hooks:",
				"  PreToolUse:",
				"    - matcher: '*'",
				"      command: 'echo hi'",
				"paths:",
				"  - src/**",
				"shell: /bin/bash",
				"disable-model-invocation: true",
				"user-invocable: false",
				"---",
				"",
				"body",
			].join("\n"),
			"utf-8",
		);

		const { commands } = loadMarkdownCommands({ cwd, agentDir });
		expect(commands).toHaveLength(1);
		const cmd = commands[0];
		expect(cmd.name).toBe("fancy");
		expect(cmd.argumentHint).toBe("<file> [extra]");
		expect(cmd.allowedTools).toEqual(["bash", "read"]);
		expect(cmd.model).toBe("claude-3-5-sonnet-latest");
		expect(cmd.effort).toBe("high");
		expect(cmd.context).toBe("fork");
		expect(cmd.agent).toBe(".cave/agents/critic.md");
		expect(cmd.hooks).toBeTypeOf("object");
		expect(cmd.paths).toEqual(["src/**"]);
		expect(cmd.shell).toBe("/bin/bash");
		expect(cmd.disableModelInvocation).toBe(true);
		expect(cmd.userInvocable).toBe(false);
	});

	it("derives a description from the first non-empty body line if missing", () => {
		writeFileSync(
			join(projectDir, "auto-desc.md"),
			"---\nname: auto-desc\n---\n\nThis is the very first paragraph.",
			"utf-8",
		);
		const { commands } = loadMarkdownCommands({ cwd, agentDir });
		expect(commands).toHaveLength(1);
		expect(commands[0].description).toContain("This is the very first paragraph");
	});

	it("hot-reloads when a markdown file is added", async () => {
		// Watcher fires on add.
		const events: string[] = [];
		const handle = watchMarkdownCommands({
			dirs: [projectDir],
			onChange: (e) => events.push(e.path),
			debounceMs: 25,
		});

		try {
			// Let the fs watcher fully register before writing — otherwise the
			// create event can race watcher setup and be missed (the flake).
			await new Promise((r) => setTimeout(r, 100));
			writeFileSync(join(projectDir, "new-cmd.md"), "---\nname: new-cmd\ndescription: hi\n---\nbody", "utf-8");

			// Poll for the event. macOS FSEvents can lag ~1s+, so use a generous
			// window; if nothing has fired by half-time, re-touch the file to
			// nudge a possibly-coalesced/dropped event.
			const start = Date.now();
			let renudged = false;
			while (events.length === 0 && Date.now() - start < 8000) {
				await new Promise((r) => setTimeout(r, 25));
				if (!renudged && Date.now() - start > 4000) {
					renudged = true;
					writeFileSync(
						join(projectDir, "new-cmd.md"),
						"---\nname: new-cmd\ndescription: hi2\n---\nbody2",
						"utf-8",
					);
				}
			}
			expect(events.length).toBeGreaterThanOrEqual(1);
			expect(events.some((p) => p.endsWith("new-cmd.md"))).toBe(true);
		} finally {
			handle.dispose();
		}
	});
});

describe("WS5 slash-commands — expansion", () => {
	let cwd: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "cave-cmd-exp-"));
		agentDir = mkdtempSync(join(tmpdir(), "cave-cmd-exp-agent-"));
		projectDir = join(cwd, ".cave", "commands");
		mkdirSync(projectDir, { recursive: true });
	});
	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("substitutes variables and runs inline shell at expansion time", async () => {
		writeFileSync(
			join(projectDir, "say.md"),
			"---\nname: say\ndescription: prints args\n---\nargs=$ARGUMENTS\nfirst=$1\nshell=`!echo SHELL_OK`\n",
			"utf-8",
		);
		const { commands } = loadMarkdownCommands({ cwd, agentDir });
		const say = commands.find((c) => c.name === "say");
		expect(say).toBeDefined();
		const result = await expandMarkdownCommand(say!, {
			cwd,
			args: ["say", "alpha", "beta"],
			rawArguments: "alpha beta",
		});
		expect(result.content).toContain("args=alpha beta");
		expect(result.content).toContain("first=alpha");
		expect(result.content).toContain("shell=SHELL_OK");
		expect(result.shellResults).toHaveLength(1);
		expect(result.shellResults[0].ok).toBe(true);
	});

	it("respects disableShell and leaves the literal in place", async () => {
		writeFileSync(
			join(projectDir, "nopre.md"),
			"---\nname: nopre\ndescription: x\n---\nshell=`!echo SHOULD_NOT_RUN`",
			"utf-8",
		);
		const { commands } = loadMarkdownCommands({ cwd, agentDir });
		const cmd = commands.find((c) => c.name === "nopre")!;
		const result = await expandMarkdownCommand(cmd, {
			cwd,
			disableShell: true,
		});
		expect(result.content).toContain("`!echo SHOULD_NOT_RUN`");
		expect(result.shellResults).toEqual([]);
	});

	it("substitutes a failed shell with an inline error marker", async () => {
		writeFileSync(join(projectDir, "boom.md"), "---\nname: boom\ndescription: x\n---\nresult=`!exit 17`", "utf-8");
		const { commands } = loadMarkdownCommands({ cwd, agentDir });
		const cmd = commands.find((c) => c.name === "boom")!;
		const result = await expandMarkdownCommand(cmd, { cwd });
		expect(result.content).toMatch(/result=\[!exit 17 .*\]/);
		expect(result.shellResults[0].ok).toBe(false);
	});
});
