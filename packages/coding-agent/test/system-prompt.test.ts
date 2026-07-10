import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
	describe("branding", () => {
		test("uses distribution product identity and documentation wording by default", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain(
				"You are an expert coding assistant operating inside Me Write Code, a coding agent harness.",
			);
			expect(prompt).toContain(
				"Me Write Code documentation (read only when the user asks about Me Write Code itself, the mewrite CLI, its SDK, extensions, themes, skills, or TUI):",
			);
			expect(prompt).not.toContain("operating inside Cave");
		});

		test("uses custom product identity and documentation labels", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				branding: {
					productDisplayName: "Acme Code",
					productCliName: "acme-code",
					productHarnessDescription: "an internal coding agent harness",
					documentationLabel: "Acme Code documentation",
				},
			});

			expect(prompt).toContain(
				"You are an expert coding assistant operating inside Acme Code, an internal coding agent harness.",
			);
			expect(prompt).toContain(
				"Acme Code documentation (read only when the user asks about Acme Code itself, the acme-code CLI, its SDK, extensions, themes, skills, or TUI):",
			);
			expect(prompt).not.toContain("operating inside Me Write Code, a coding agent harness");
		});

		test("keeps branding fields single-line", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				branding: {
					productDisplayName: "Acme\n# Injected",
					documentationLabel: "Acme\r\nDocs",
				},
			});

			expect(prompt).toContain("operating inside Acme # Injected, a coding agent harness");
			expect(prompt).toContain("Acme Docs (read only");
			expect(prompt).not.toContain("\n# Injected");
		});
	});

	describe("appendSystemPrompt", () => {
		test("adds downstream text after defaults while preserving core sections", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				appendSystemPrompt: "Downstream context: use Acme issue IDs.",
			});

			expect(prompt).toContain("# System");
			expect(prompt).toContain("# Doing tasks");
			expect(prompt).toContain("# Executing actions with care");
			expect(prompt).toContain("# Using your tools");
			expect(prompt.indexOf("# Downstream system prompt additions")).toBeGreaterThan(
				prompt.indexOf("Me Write Code documentation"),
			);
			expect(prompt).toContain("Downstream context: use Acme issue IDs.");
			expect(prompt).toContain("If they conflict with earlier system sections, earlier system sections win.");
		});
	});

	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("safety and scope guardrails", () => {
		test("includes durable memory consent boundaries and zbrain routing", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("# Durable memory and data boundaries");
			expect(prompt).toContain("unless the user explicitly requests it or approves a preview");
			expect(prompt).toContain("default to no durable capture");
			expect(prompt).toContain("search durable memory through Me Write memory tools");
			expect(prompt).toContain("zbrain is the default source when the configured memory backend is available");
			expect(prompt).toContain("use Me Write memory tools and the configured memory backend/filing rules");
			expect(prompt).toContain("ask where to write before persisting");
		});

		test("scopes read-only reviews away from mutation workflows", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("# Instruction precedence and scope");
			expect(prompt).toContain("For read-only reviews and investigations");
			expect(prompt).toContain(
				"do not run git/worktree, validation, release, commit/push, deploy, or durable-memory workflows",
			);
		});

		test("includes validation decision tree and scoped file-reading guidance", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("# Validation");
			expect(prompt).toContain("Read-only or documentation-only tasks do not require validation commands");
			expect(prompt).toContain("Before modifying human-authored source or docs");
			expect(prompt).toContain("For large, generated, lock, or binary-adjacent files");
		});

		test("routes broad external lookup through matching MCP tools", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Before broad web/data/repo/external-system lookup");
			expect(prompt).toContain("use the most specific matching MCP tool");
			expect(prompt).toContain("Use built-in local file tools for repo file search/editing");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});
});
