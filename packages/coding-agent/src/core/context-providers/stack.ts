import type { ContextBundle, ContextEngine, ContextHealth, ContextPack, ContextQuery } from "../context-engine.js";
import { redactContextDetail } from "../context-engine.js";

export interface ContextStackChild {
	name: string;
	engine: ContextEngine;
	includeCode: boolean;
	includeMemory: boolean;
}

export interface ContextStackEngineOptions {
	children: ContextStackChild[];
	childTimeoutMs: number;
}

interface ChildResult {
	child: ContextStackChild;
	pack?: ContextPack;
	durationMs: number;
	error?: Error;
	state: "ok" | "error" | "timeout";
}

const SOURCE_ORDER = ["codescry", "qmd"];

export function estimateBundleTokens(bundle: ContextBundle): number {
	return bundle.tokenEstimate ?? Math.ceil(Buffer.byteLength(bundle.content, "utf8") / 4) + 80;
}

function sourceRank(source: string): number {
	const index = SOURCE_ORDER.indexOf(source);
	return index === -1 ? SOURCE_ORDER.length : index;
}

function compareBundles(a: ContextBundle, b: ContextBundle): number {
	const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
	if (scoreDelta !== 0) return scoreDelta;
	return sourceRank(a.source) - sourceRank(b.source);
}

export interface BudgetedContextResult {
	bundles: ContextBundle[];
	usedTokens: number;
	returned: number;
	includedBySource: Record<string, number>;
	droppedBySource: Record<string, number>;
}

export function mergeAndBudgetBundles(bundles: ContextBundle[], budgetTokens: number): BudgetedContextResult {
	const returned = bundles.length;
	const included: ContextBundle[] = [];
	const includedIds = new Set<string>();
	let usedTokens = 0;
	const includedBySource: Record<string, number> = {};
	const droppedBySource: Record<string, number> = {};
	const sortedBySource = new Map<string, ContextBundle[]>();
	for (const bundle of bundles) {
		const group = sortedBySource.get(bundle.source) ?? [];
		group.push(bundle);
		sortedBySource.set(bundle.source, group);
	}
	for (const group of sortedBySource.values()) {
		group.sort(compareBundles);
	}

	const tryInclude = (bundle: ContextBundle, force = false) => {
		if (includedIds.has(bundle.id)) return false;
		const estimate = estimateBundleTokens(bundle);
		if (!force && usedTokens + estimate > budgetTokens) return false;
		included.push(bundle);
		includedIds.add(bundle.id);
		usedTokens += estimate;
		includedBySource[bundle.source] = (includedBySource[bundle.source] ?? 0) + 1;
		return true;
	};

	if (budgetTokens > 0) {
		for (const source of SOURCE_ORDER) {
			const first = sortedBySource.get(source)?.[0];
			if (first) tryInclude(first);
		}
		const remaining = bundles.filter((bundle) => !includedIds.has(bundle.id)).sort(compareBundles);
		for (const bundle of remaining) {
			tryInclude(bundle);
		}
		if (included.length === 0 && bundles.length > 0) {
			tryInclude([...bundles].sort(compareBundles)[0], true);
		}
	}

	for (const bundle of bundles) {
		if (!includedIds.has(bundle.id)) droppedBySource[bundle.source] = (droppedBySource[bundle.source] ?? 0) + 1;
	}
	return { bundles: included, usedTokens, returned, includedBySource, droppedBySource };
}

export class ContextStackEngine implements ContextEngine {
	readonly name = "stack";
	constructor(private readonly options: ContextStackEngineOptions) {}

	async health(): Promise<ContextHealth> {
		return { enabled: true, provider: "stack", ok: true, detail: this.options.children.map((c) => c.name).join(",") };
	}

	async retrieve(query: ContextQuery): Promise<ContextPack> {
		const results = await Promise.all(this.options.children.map((child) => this.runChild(child, query)));
		const bundles = results.flatMap((result) => result.pack?.bundles ?? []);
		const budgeted = mergeAndBudgetBundles(bundles, query.budgetTokens);
		const sources: ContextPack["sources"] = {};
		for (const result of results) {
			const returned = result.pack?.bundles.length ?? 0;
			const included = budgeted.includedBySource[result.child.name] ?? 0;
			const dropped = budgeted.droppedBySource[result.child.name] ?? 0;
			sources[result.child.name] = {
				ok: result.state === "ok",
				detail:
					result.state === "ok"
						? `returned=${returned} included=${included} dropped=${dropped} durationMs=${result.durationMs}`
						: `state=${result.state} returned=0 included=0 dropped=0 durationMs=${result.durationMs}${result.error?.message ? ` ${redactContextDetail(result.error.message)}` : ""}`,
			};
		}
		sources.stack = {
			ok: true,
			detail: `providers=${this.options.children.length} returned=${budgeted.returned} included=${budgeted.bundles.length} dropped=${Object.values(budgeted.droppedBySource).reduce((sum, n) => sum + n, 0)} budgetTokens=${query.budgetTokens} usedTokens=${budgeted.usedTokens}`,
		};
		return { bundles: budgeted.bundles, sources };
	}

	private async runChild(child: ContextStackChild, query: ContextQuery): Promise<ChildResult> {
		const start = Date.now();
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		query.signal?.addEventListener("abort", onAbort, { once: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => {
						controller.abort();
						reject(new Error(`${child.name} timed out`));
					},
					Math.max(1, this.options.childTimeoutMs),
				);
			});
			const pack = await Promise.race([
				child.engine.retrieve({
					...query,
					includeCode: child.includeCode,
					includeMemory: child.includeMemory,
					signal: controller.signal,
				}),
				timeout,
			]);
			return { child, pack, durationMs: Date.now() - start, state: "ok" };
		} catch (error) {
			if (query.signal?.aborted) throw error;
			return {
				child,
				durationMs: Date.now() - start,
				error: error instanceof Error ? error : new Error(String(error)),
				state: controller.signal.aborted ? "timeout" : "error",
			};
		} finally {
			if (timer) clearTimeout(timer);
			query.signal?.removeEventListener("abort", onAbort);
		}
	}
}
