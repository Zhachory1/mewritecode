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
