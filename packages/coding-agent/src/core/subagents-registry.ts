/**
 * Subagent registry for the F2 overlay (WS6).
 *
 * Listens to the agent's tool execution events and tracks `task`/`agent` tool
 * calls as subagent rows. The TUI's `SubagentOverlay` reads this via
 * `list()` + `subscribe()` and re-renders on every change.
 *
 * Note: tracking is shallow — one row per parent-side tool call. The Task
 * tool spawns its own child cave processes; we don't try to mirror their
 * internal state here, just the parent's view of "this child is running".
 */

import type { SubagentRegistry, SubagentSnapshot } from "@juliusbrussee/caveman-tui";

interface InternalRow {
	id: string;
	name: string;
	currentTool?: string;
	startMs: number;
	status: "running" | "done" | "error";
}

const SUBAGENT_TOOL_NAMES = new Set(["task", "agent"]);

export class InMemorySubagentRegistry implements SubagentRegistry {
	private rows = new Map<string, InternalRow>();
	private listeners = new Set<() => void>();

	list(): SubagentSnapshot[] {
		const now = Date.now();
		return Array.from(this.rows.values()).map((r) => ({
			id: r.id,
			name: r.name,
			currentTool: r.currentTool,
			tokensIn: 0,
			tokensOut: 0,
			elapsedMs: now - r.startMs,
			status: r.status,
		}));
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const fn of this.listeners) {
			try {
				fn();
			} catch {
				// listener errors must not break the registry
			}
		}
	}

	onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): void {
		if (!SUBAGENT_TOOL_NAMES.has(toolName)) return;
		const label = readLabel(args, toolName);
		this.rows.set(toolCallId, {
			id: toolCallId,
			name: label,
			currentTool: toolName,
			startMs: Date.now(),
			status: "running",
		});
		this.notify();
	}

	onToolEnd(toolCallId: string, toolName: string, isError: boolean): void {
		if (!SUBAGENT_TOOL_NAMES.has(toolName)) return;
		const row = this.rows.get(toolCallId);
		if (!row) return;
		row.status = isError ? "error" : "done";
		this.notify();
		// Keep the row visible briefly for the overlay's "completed" line; the
		// overlay can prune it on its own cadence if it wants.
	}

	clear(): void {
		this.rows.clear();
		this.notify();
	}
}

function readLabel(args: Record<string, unknown>, fallback: string): string {
	const agent = typeof args.agent === "string" ? args.agent : undefined;
	if (agent) return agent;
	if (Array.isArray(args.tasks) && args.tasks.length > 0) {
		const first = args.tasks[0] as { agent?: string };
		if (first?.agent) return `${first.agent} +${args.tasks.length - 1}`;
	}
	if (Array.isArray(args.chain) && args.chain.length > 0) {
		const first = args.chain[0] as { agent?: string };
		if (first?.agent) return `chain:${first.agent} +${args.chain.length - 1}`;
	}
	return fallback;
}
