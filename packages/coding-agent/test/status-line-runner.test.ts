/**
 * Tests for the status line runner — verifies the spawn path against a
 * shell command and the synchronous fall-throughs for default/detailed.
 */
import type { StatusLineContext } from "@zhachory1/mewrite-tui";
import { describe, expect, it } from "vitest";
import { createStatusLineRenderer } from "../src/core/status-line-runner.js";

function ctx(overrides: Partial<StatusLineContext> = {}): StatusLineContext {
	return {
		hook_event_name: "Status",
		session_id: "s1",
		cwd: "/tmp",
		model: { id: "claude-opus-4-7", display_name: "Opus 4.7" },
		workspace: { current_dir: "/tmp", project_dir: "/tmp" },
		...overrides,
	};
}

describe("createStatusLineRenderer", () => {
	it("returns the default renderer for missing settings", async () => {
		const renderer = createStatusLineRenderer(undefined);
		const result = await renderer.render(ctx());
		expect(result.source).toBe("default");
		expect(result.text).toContain("Opus 4.7");
	});

	it("returns the detailed renderer for type='detailed'", async () => {
		const renderer = createStatusLineRenderer({ type: "detailed" });
		const result = await renderer.render(
			ctx({
				cost: { total_cost_usd: 0.0042, total_duration_ms: 1234 },
				cave: { branch: "main", queuedMessages: 1 },
			}),
		);
		expect(result.source).toBe("detailed");
		expect(result.text).toContain("$0.0042");
		expect(result.text).toContain("q:1");
	});

	it("falls back to default when type='command' but command is missing", async () => {
		const renderer = createStatusLineRenderer({ type: "command" });
		const result = await renderer.render(ctx());
		expect(result.source).toBe("default");
	});

	it("runs a configured shell command and returns its stdout", async () => {
		const renderer = createStatusLineRenderer({ type: "command", command: "echo 'cave-status-ok'" });
		const result = await renderer.render(ctx());
		expect(result.source).toBe("command");
		expect(result.text).toBe("cave-status-ok");
	});

	it("surfaces command-failed when the command exits non-zero", async () => {
		const renderer = createStatusLineRenderer({ type: "command", command: "echo broke 1>&2; exit 7" });
		const result = await renderer.render(ctx());
		expect(result.source).toBe("command-failed");
		expect(result.stderr).toMatch(/broke|exit/);
	});

	it("trims newlines from command stdout to a single line", async () => {
		const renderer = createStatusLineRenderer({ type: "command", command: "printf 'line1\\nline2\\n'" });
		const result = await renderer.render(ctx());
		expect(result.source).toBe("command");
		expect(result.text).toBe("line1 line2");
	});
});
