import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@zhachory1/mewrite-ai";
import { describe, expect, it } from "vitest";
import { mapQmdResult, QmdContextEngine } from "../src/core/context-providers/qmd.js";
import { createHarness } from "./suite/harness.js";

function fakeQmdScript(body: string): string {
	const dir = join(tmpdir(), `qmd-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "qmd");
	writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

function result(overrides: Record<string, unknown> = {}) {
	return {
		docid: "#abc123",
		score: 0.89,
		file: "qmd://notes/projects/mewritecode/context.md",
		line: 42,
		title: "Context notes",
		context: "Me Write notes",
		snippet: "QMD should be treated as experimental local retrieval.",
		...overrides,
	};
}

describe("QmdContextEngine", () => {
	it("maps QMD results to memory context bundles with provenance", () => {
		const bundle = mapQmdResult(result());

		expect(bundle.source).toBe("qmd");
		expect(bundle.entityType).toBe("memory");
		expect(bundle.title).toBe("Context notes");
		expect(bundle.content).toContain("experimental local retrieval");
		expect(bundle.provenance.path).toBe("qmd://notes/projects/mewritecode/context.md");
		expect(bundle.provenance.startLine).toBe(42);
		expect(bundle.provenance.memoryId).toBe("#abc123");
		expect(bundle.retrievalHandle?.id).toBe("#abc123");
	});

	it("uses qmd query json with collection filters and no rerank", async () => {
		const command = fakeQmdScript(`
const argv = process.argv.slice(2);
if (argv[0] !== 'query') process.exit(8);
if (argv[1] !== 'where is context') process.exit(7);
if (!argv.includes('--json') || !argv.includes('--no-rerank')) process.exit(6);
if (argv[argv.indexOf('-n') + 1] !== '3') process.exit(5);
if (!argv.includes('-c') || !argv.includes('notes') || !argv.includes('docs')) process.exit(4);
process.stdout.write(JSON.stringify([${JSON.stringify(result())}]));
`);
		const engine = new QmdContextEngine({ command, maxResults: 3, collections: ["notes", "docs"] });
		const pack = await engine.retrieve({
			rawUserPrompt: "where is context",
			cwd: process.cwd(),
			budgetTokens: 100,
			includeCode: false,
			includeMemory: true,
		});

		expect(pack.bundles).toHaveLength(1);
		expect(pack.sources.qmd.detail).toContain("bundles=1");
		expect(pack.sources.qmd.detail).toContain("collections=notes,docs");
	});

	it("treats empty results as healthy empty context", async () => {
		const command = fakeQmdScript("process.stdout.write(JSON.stringify([]));");
		const engine = new QmdContextEngine({ command });
		const pack = await engine.retrieve({
			rawUserPrompt: "empty",
			cwd: process.cwd(),
			budgetTokens: 100,
			includeCode: false,
			includeMemory: true,
		});

		expect(pack.bundles).toHaveLength(0);
		expect(pack.sources.qmd.ok).toBe(true);
	});

	it("fails open with typed state on malformed JSON", async () => {
		const command = fakeQmdScript("process.stdout.write('not json');");
		const engine = new QmdContextEngine({ command });

		await expect(
			engine.retrieve({
				rawUserPrompt: "bad",
				cwd: process.cwd(),
				budgetTokens: 100,
				includeCode: false,
				includeMemory: true,
			}),
		).rejects.toMatchObject({ state: "schema-mismatch" });
	});

	it("fails open when all rows are malformed", async () => {
		const command = fakeQmdScript(`process.stdout.write(JSON.stringify([{ file: 'x', snippet: 'missing docid' }]))`);
		const engine = new QmdContextEngine({ command });

		await expect(
			engine.retrieve({
				rawUserPrompt: "bad",
				cwd: process.cwd(),
				budgetTokens: 100,
				includeCode: false,
				includeMemory: true,
			}),
		).rejects.toMatchObject({ state: "malformed-result" });
	});

	it("integrates through AgentSession without persisting snippets", async () => {
		const command = fakeQmdScript(`process.stdout.write(JSON.stringify([${JSON.stringify(result())}]))`);
		let payloadText = "";
		const harness = await createHarness({
			settings: {
				contextEngine: {
					enabled: true,
					provider: "qmd",
					timeoutMs: 1000,
					qmd: { command, maxResults: 1, collections: ["notes"] },
				},
			},
		});
		try {
			harness.setResponses([
				(context) => {
					payloadText = JSON.stringify(context.messages);
					return fauxAssistantMessage("ok");
				},
			]);
			await harness.session.prompt("where is context");

			expect(payloadText).toContain("qmd://notes/projects/mewritecode/context.md");
			expect(payloadText).toContain("QMD should be treated as experimental local retrieval");
			expect(JSON.stringify(harness.session.messages)).not.toContain("experimental local retrieval");
			const status = harness.session.getContextEngineStatusLines().join("\n");
			expect(status).toContain("Provider: qmd");
			expect(status).toContain("QMD command:");
			expect(status).toContain("QMD collections: notes");
			expect(status).not.toContain("experimental local retrieval");
		} finally {
			harness.cleanup();
		}
	});

	it("fails open through AgentSession when qmd is missing", async () => {
		const harness = await createHarness({
			settings: {
				contextEngine: {
					enabled: true,
					provider: "qmd",
					timeoutMs: 1000,
					qmd: { command: join(tmpdir(), "missing-qmd-binary") },
				},
			},
		});
		try {
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hello");

			const status = harness.session.getContextEngineStatusLines().join("\n");
			expect(status).toContain("missing-binary");
			expect(status).toContain("Bundles last turn: 0");
		} finally {
			harness.cleanup();
		}
	});
});
