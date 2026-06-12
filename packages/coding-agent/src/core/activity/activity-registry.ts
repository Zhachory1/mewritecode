export type ActivityKind = "model" | "tool" | "subagent" | "process" | "mcp";
export type ActivityStatus = "running" | "queued" | "done" | "error";

export interface Activity {
	id: string;
	kind: ActivityKind;
	label: string;
	detail?: string;
	status: ActivityStatus;
	startedAt: number;
	lastProgressAt?: number;
	endedAt?: number;
	parentId?: string;
}

export interface ActivitySnapshot extends Activity {
	depth: number;
	elapsedMs: number;
	/** now - lastProgressAt (0 if never progress-tracked or just progressed) */
	stalledMs: number;
}

const PRUNE_MS = 4000;
const PRUNE_ERR_MS = 8000;
/** Cycle/runaway guard for the parent-chain depth walk. */
const MAX_DEPTH_GUARD = 8;

export class ActivityRegistry {
	private items = new Map<string, Activity>();
	private order: string[] = [];
	private listeners = new Set<() => void>();
	private pruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private pruning = true;
	private disposed = false;
	private notifyScheduled = false;

	begin(a: Omit<Activity, "status"> & { status?: ActivityStatus }): void {
		if (this.disposed) return;
		const existing = this.items.get(a.id);
		if (existing) {
			// Idempotent: a duplicate begin (e.g. subagent_progress "started"
			// arriving after tool_execution_start for the same id) updates mutable
			// fields but MUST preserve the original startedAt/lastProgressAt so
			// elapsed never jumps backwards.
			const { startedAt: _ignoredStart, lastProgressAt: _ignoredProgress, ...rest } = a;
			Object.assign(existing, rest, { status: a.status ?? existing.status });
			this.notify();
			return;
		}
		this.items.set(a.id, { status: "running", lastProgressAt: a.startedAt, ...a });
		this.order.push(a.id);
		this.notify();
	}

	update(
		id: string,
		patch: Partial<Pick<Activity, "detail" | "status" | "label" | "lastProgressAt" | "parentId">>,
	): void {
		const it = this.items.get(id);
		if (!it) return;
		Object.assign(it, patch);
		this.notify();
	}

	end(id: string, opts?: { error?: boolean }): void {
		const it = this.items.get(id);
		if (!it) return;
		it.status = opts?.error ? "error" : "done";
		it.endedAt = Date.now();
		this.schedulePrune(id);
		this.notify();
	}

	setPruning(on: boolean): void {
		this.pruning = on;
		if (on) {
			for (const id of [...this.items.keys()]) {
				const it = this.items.get(id);
				if (it?.endedAt) this.schedulePrune(id);
			}
		} else {
			for (const t of this.pruneTimers.values()) clearTimeout(t);
			this.pruneTimers.clear();
		}
	}

	private schedulePrune(id: string): void {
		if (!this.pruning) return;
		const it = this.items.get(id);
		if (!it?.endedAt) return;
		const old = this.pruneTimers.get(id);
		if (old) clearTimeout(old);
		const ms = it.status === "error" ? PRUNE_ERR_MS : PRUNE_MS;
		this.pruneTimers.set(
			id,
			setTimeout(() => this.remove(id), ms),
		);
	}

	private remove(id: string): void {
		this.items.delete(id);
		this.order = this.order.filter((x) => x !== id);
		this.pruneTimers.delete(id);
		this.notify();
	}

	list(): ActivitySnapshot[] {
		const now = Date.now();
		const snaps = this.order
			.filter((id) => this.items.has(id))
			.map((id) => {
				const a = this.items.get(id) as Activity;
				return {
					...a,
					depth: this.depthOf(a),
					elapsedMs: (a.endedAt ?? now) - a.startedAt,
					stalledMs: a.lastProgressAt ? now - a.lastProgressAt : 0,
				};
			});
		const rank = (s: ActivityStatus) => (s === "running" || s === "queued" ? 0 : 1);
		return snaps.sort((x, y) => rank(x.status) - rank(y.status) || y.elapsedMs - x.elapsedMs);
	}

	blockingLeaf(): ActivitySnapshot | undefined {
		const running = this.list().filter((a) => a.status === "running");
		const leaves = running.filter((a) => a.kind !== "model");
		return leaves[0] ?? running.find((a) => a.kind === "model");
	}

	private depthOf(a: Activity): number {
		let d = 0;
		let cur = a.parentId;
		let guard = 0;
		while (cur && this.items.has(cur) && guard++ < MAX_DEPTH_GUARD) {
			d++;
			cur = this.items.get(cur)?.parentId;
		}
		return d;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify(): void {
		if (this.disposed || this.notifyScheduled) return;
		this.notifyScheduled = true;
		queueMicrotask(() => {
			this.notifyScheduled = false;
			if (this.disposed) return;
			for (const l of this.listeners) l();
		});
	}

	clear(): void {
		for (const t of this.pruneTimers.values()) clearTimeout(t);
		this.pruneTimers.clear();
		this.items.clear();
		this.order = [];
		this.notify();
	}

	dispose(): void {
		this.disposed = true;
		for (const t of this.pruneTimers.values()) clearTimeout(t);
		this.pruneTimers.clear();
		this.listeners.clear();
	}
}
