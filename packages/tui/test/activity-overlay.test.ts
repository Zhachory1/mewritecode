/**
 * Tests for the F2 activity monitor overlay (ActivityOverlay).
 *
 * The overlay renders a flat list of session activities (model calls, tools,
 * subagents) with elapsed + stalled detection. It defines its OWN structural
 * snapshot interface so the low-level tui package never imports from
 * coding-agent — the registry there returns structurally-compatible objects.
 *
 * These tests pass plain snapshot arrays (and a fake registry) directly, so
 * there are no real timers involved.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { ActivityOverlay, type ActivityOverlayRegistry, type ActivitySnapshot } from "../src/index.js";

function snap(over: Partial<ActivitySnapshot> & Pick<ActivitySnapshot, "id" | "kind" | "label">): ActivitySnapshot {
	return {
		detail: undefined,
		status: "running",
		startedAt: 0,
		elapsedMs: 0,
		stalledMs: 0,
		depth: 0,
		...over,
	};
}

function makeRegistry(initial: ActivitySnapshot[]): ActivityOverlayRegistry & { update(s: ActivitySnapshot[]): void } {
	let list = initial;
	const listeners = new Set<() => void>();
	return {
		list: () => list,
		subscribe: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		update(s) {
			list = s;
			for (const l of listeners) l();
		},
	};
}

describe("ActivityOverlay", () => {
	it("renders the idle empty-state", () => {
		const overlay = new ActivityOverlay({ registry: makeRegistry([]) });
		const lines = overlay.render(40);
		assert.strictEqual(lines.length, 2);
		assert.ok(lines[0].includes("Activity"));
		assert.ok(lines.some((l) => l.includes("No activity — session idle.")));
	});

	it("renders header counts: running + queued", () => {
		const reg = makeRegistry([
			snap({ id: "t1", kind: "tool", label: "bash", status: "running" }),
			snap({ id: "t2", kind: "tool", label: "grep", status: "running" }),
			snap({ id: "q1", kind: "tool", label: "queued-tool", status: "queued" }),
		]);
		const overlay = new ActivityOverlay({ registry: reg });
		const lines = overlay.render(60);
		assert.ok(lines[0].includes("Activity (2 running"), `header was: ${lines[0]}`);
		assert.ok(lines[0].includes("1 queued"), `header was: ${lines[0]}`);
	});

	it("renders the right glyph per status (running/stalled/queued/done/error)", () => {
		const reg = makeRegistry([
			snap({ id: "r", kind: "tool", label: "running-row", status: "running", elapsedMs: 5000 }),
			snap({ id: "s", kind: "model", label: "stalled-row", status: "running", elapsedMs: 30000, stalledMs: 20000 }),
			snap({ id: "q", kind: "tool", label: "queued-row", status: "queued" }),
			snap({ id: "d", kind: "tool", label: "done-row", status: "done" }),
			snap({ id: "e", kind: "tool", label: "error-row", status: "error" }),
		]);
		const overlay = new ActivityOverlay({ registry: reg, maxRows: 20 });
		const lines = overlay.render(80);
		const line = (label: string) => lines.find((l) => l.includes(label)) ?? "";
		assert.ok(line("running-row").includes("●"), line("running-row"));
		assert.ok(line("stalled-row").includes("◍"), line("stalled-row"));
		assert.ok(line("queued-row").includes("◌"), line("queued-row"));
		assert.ok(line("done-row").includes("○"), line("done-row"));
		assert.ok(line("error-row").includes("✗"), line("error-row"));
	});

	it("renders detail after the label with a colon", () => {
		const reg = makeRegistry([
			snap({ id: "t", kind: "tool", label: "bash", detail: "npm install", elapsedMs: 1000 }),
		]);
		const overlay = new ActivityOverlay({ registry: reg });
		const lines = overlay.render(80);
		assert.ok(
			lines.some((l) => l.includes("bash: npm install")),
			lines.join("\n"),
		);
	});

	it("indents nested activity rows by depth", () => {
		const reg = makeRegistry([
			snap({ id: "parent", kind: "subagent", label: "reviewer", elapsedMs: 2000, depth: 0 }),
			snap({ id: "child", kind: "tool", label: "bash", detail: "npm test", elapsedMs: 1000, depth: 1 }),
		]);
		const overlay = new ActivityOverlay({ registry: reg, maxRows: 20 });
		const lines = overlay.render(80);
		const child = lines.find((l) => l.includes("bash: npm test")) ?? "";

		assert.match(child, / {2}● bash: npm test/);
	});

	it("renders elapsed and ' · stalled Ns' when stalled past the threshold", () => {
		const reg = makeRegistry([
			snap({
				id: "t",
				kind: "model",
				label: "model response",
				status: "running",
				elapsedMs: 62000,
				stalledMs: 18000,
			}),
		]);
		const overlay = new ActivityOverlay({ registry: reg });
		const lines = overlay.render(80);
		const row = lines.find((l) => l.includes("model response")) ?? "";
		assert.ok(row.includes("1m02s"), row);
		assert.ok(row.includes("stalled 18s"), row);
	});

	it("does NOT render stalled when below threshold", () => {
		const reg = makeRegistry([
			snap({ id: "t", kind: "model", label: "model response", status: "running", elapsedMs: 4000, stalledMs: 2000 }),
		]);
		const overlay = new ActivityOverlay({ registry: reg });
		const lines = overlay.render(80);
		const row = lines.find((l) => l.includes("model response")) ?? "";
		assert.ok(!row.includes("stalled"), row);
	});

	it("marks the blocking leaf (first running non-model row)", () => {
		const reg = makeRegistry([
			snap({ id: "m", kind: "model", label: "model response", status: "running", elapsedMs: 9000 }),
			snap({ id: "t", kind: "tool", label: "bash", status: "running", elapsedMs: 3000 }),
		]);
		const overlay = new ActivityOverlay({ registry: reg, maxRows: 20 });
		const lines = overlay.render(80);
		const bashRow = lines.find((l) => l.includes("bash")) ?? "";
		const modelRow = lines.find((l) => l.includes("model response")) ?? "";
		assert.ok(bashRow.includes("▸"), `blocker bash row should be marked: ${bashRow}`);
		assert.ok(!modelRow.includes("▸"), `non-blocker model row should not be marked: ${modelRow}`);
	});

	it("marks the model row as blocker when it is the only runner", () => {
		const reg = makeRegistry([
			snap({ id: "m", kind: "model", label: "model response", status: "running", elapsedMs: 9000 }),
			snap({ id: "d", kind: "tool", label: "done-tool", status: "done", elapsedMs: 100 }),
		]);
		const overlay = new ActivityOverlay({ registry: reg, maxRows: 20 });
		const lines = overlay.render(80);
		const modelRow = lines.find((l) => l.includes("model response")) ?? "";
		assert.ok(modelRow.includes("▸"), `lone model runner should be marked: ${modelRow}`);
	});

	it("caps rows at maxRows with '… +N more'", () => {
		const many = Array.from({ length: 6 }, (_, i) =>
			snap({ id: `s${i}`, kind: "tool", label: `tool-${i}`, status: "running", elapsedMs: (6 - i) * 1000 }),
		);
		const overlay = new ActivityOverlay({ registry: makeRegistry(many), maxRows: 3 });
		const lines = overlay.render(60);
		// header + 3 rows + overflow line
		assert.strictEqual(lines.length, 5);
		assert.ok(lines[lines.length - 1].includes("+3 more"), lines[lines.length - 1]);
	});

	it("always renders the blocker even when it would overflow maxRows", () => {
		// blocker (the running tool) is sorted LAST here by giving it the smallest elapsed;
		// fill the visible slots with longer-running rows so the blocker would be cut.
		const rows: ActivitySnapshot[] = [
			snap({ id: "a", kind: "tool", label: "long-a", status: "running", elapsedMs: 9000 }),
			snap({ id: "b", kind: "tool", label: "long-b", status: "running", elapsedMs: 8000 }),
			snap({ id: "c", kind: "tool", label: "blocker-c", status: "running", elapsedMs: 1000 }),
		];
		// Force the overlay to treat "blocker-c" as the blocker by making the others model-kind?
		// Instead: maxRows=1 keeps only "long-a"; blocker (first running non-model) is "long-a" itself,
		// so to exercise the always-render path put a model row first (skipped as blocker) and the
		// real blocker further down.
		const reg = makeRegistry([
			snap({ id: "m", kind: "model", label: "model-row", status: "running", elapsedMs: 20000 }),
			...rows,
		]);
		const overlay = new ActivityOverlay({ registry: reg, maxRows: 1 });
		const lines = overlay.render(70);
		// The blocker (first running non-model = "long-a") must always appear even though
		// maxRows=1 would show the model row first.
		assert.ok(
			lines.some((l) => l.includes("long-a") && l.includes("▸")),
			lines.join("\n"),
		);
	});

	it("redraws on registry change via bindRedraw", () => {
		const reg = makeRegistry([]);
		const overlay = new ActivityOverlay({ registry: reg });
		let redraws = 0;
		overlay.bindRedraw(() => {
			redraws++;
		});
		reg.update([snap({ id: "x", kind: "tool", label: "y", status: "running" })]);
		reg.update([]);
		assert.strictEqual(redraws, 2);
		overlay.dispose();
	});
});
