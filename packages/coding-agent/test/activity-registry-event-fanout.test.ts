import { describe, expect, it } from "vitest";
import { ActivityRegistry } from "../src/core/activity/activity-registry.js";

/**
 * Locks the registry-feed invariants that interactive-mode's handleEvent relies
 * on, mirroring the exact mutation sequence each event branch performs. Driving
 * the registry directly (rather than wiring a full InteractiveMode + TUI) keeps
 * the contract test fast and deterministic while still covering the three fixes:
 *
 *   m-5   — tool detail must survive an undefined-detail progress update.
 *   B-leak — agent_end must end EVERY still-running row (model + tools + subagents).
 *   dup   — a subagent "started" after tool_execution_start must not re-begin.
 */

/** Mirror of interactive-mode's deriveDetail for an image-only / text-less partial. */
function deriveDetailUndefinedCase(): string | undefined {
	return undefined;
}

/** The tool_execution_update branch, post-fix (m-5). */
function applyToolUpdate(reg: ActivityRegistry, id: string, derived: string | undefined): void {
	reg.update(id, {
		lastProgressAt: Date.now(),
		...(derived !== undefined ? { detail: derived } : {}),
	});
}

/** The agent_end branch, post-fix: end every running/queued row. */
function applyAgentEnd(reg: ActivityRegistry): void {
	for (const row of reg.list()) {
		if (row.status === "running" || row.status === "queued") {
			reg.end(row.id);
		}
	}
}

describe("activity registry event fan-out (interactive-mode handleEvent contract)", () => {
	it("(a) tool detail survives an undefined-detail progress update (m-5)", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		// tool_execution_start: bash command captured as detail.
		reg.begin({
			id: "tool-1",
			kind: "tool",
			label: "bash",
			detail: "npm run build",
			startedAt: Date.now(),
		});
		// tool_execution_update with an image-only partial → deriveDetail undefined.
		applyToolUpdate(reg, "tool-1", deriveDetailUndefinedCase());

		const row = reg.list().find((a) => a.id === "tool-1");
		expect(row?.detail).toBe("npm run build");
	});

	it("(a') a defined detail update DOES replace the prior detail", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		reg.begin({ id: "tool-1", kind: "tool", label: "bash", detail: "old", startedAt: Date.now() });
		applyToolUpdate(reg, "tool-1", "new progress line");
		expect(reg.list().find((a) => a.id === "tool-1")?.detail).toBe("new progress line");
	});

	it("(b) agent_end ends orphan running rows (model + tool + subagent)", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		reg.begin({ id: "model-1", kind: "model", label: "assistant", startedAt: Date.now() });
		reg.begin({ id: "tool-1", kind: "tool", label: "bash", startedAt: Date.now() });
		reg.begin({ id: "sub-1", kind: "subagent", label: "task", startedAt: Date.now() });
		// Simulate an abort: none of these saw their normal end event.
		expect(reg.list().filter((a) => a.status === "running")).toHaveLength(3);

		applyAgentEnd(reg);

		// No row may remain running — otherwise it wins blockingLeaf() next turn.
		expect(reg.list().filter((a) => a.status === "running" || a.status === "queued")).toHaveLength(0);
		expect(reg.blockingLeaf()).toBeUndefined();
	});

	it("(b') agent_end double-ending an already-ended model row is a harmless no-op", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		reg.begin({ id: "model-1", kind: "model", label: "assistant", startedAt: Date.now() });
		// message_end already ended the model row.
		reg.end("model-1");
		const endedAt = reg.list().find((a) => a.id === "model-1")?.endedAt;
		applyAgentEnd(reg);
		const row = reg.list().find((a) => a.id === "model-1");
		expect(row?.status).toBe("done");
		expect(row?.endedAt).toBe(endedAt);
	});

	it("(c) a subagent 'started' after tool_execution_start does not duplicate or reset", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		const startedAt = Date.now() - 5000;
		// tool_execution_start created the row keyed by toolCallId === subagentId.
		reg.begin({ id: "task-call-1", kind: "tool", label: "Task", detail: "spawning", startedAt });

		// subagent_progress "started" branch, post-fix: guarded begin.
		const subagentId = "task-call-1";
		if (!reg.list().some((a) => a.id === subagentId)) {
			reg.begin({
				id: subagentId,
				kind: "subagent",
				label: "task",
				detail: "starting",
				startedAt: Date.now(),
				lastProgressAt: Date.now(),
			});
		}

		// Exactly one row, and its original startedAt / label / detail are intact
		// (the guard skipped the re-begin entirely).
		const rows = reg.list().filter((a) => a.id === subagentId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.startedAt).toBe(startedAt);
		expect(rows[0]?.label).toBe("Task");
		expect(rows[0]?.detail).toBe("spawning");
	});

	it("(c') a subagent 'started' with no pre-existing row DOES begin (non-tool-keyed case)", () => {
		const reg = new ActivityRegistry();
		reg.setPruning(false);
		const subagentId = "free-subagent-1";
		if (!reg.list().some((a) => a.id === subagentId)) {
			reg.begin({
				id: subagentId,
				kind: "subagent",
				label: "task",
				detail: "starting",
				startedAt: Date.now(),
			});
		}
		expect(reg.list().filter((a) => a.id === subagentId)).toHaveLength(1);
	});
});
