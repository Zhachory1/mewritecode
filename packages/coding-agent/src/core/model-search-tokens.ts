import type { Model } from "@juliusbrussee/caveman-ai";

export type CostTier = "cheap" | "mid" | "exp";

export interface ModelPredicate {
	test: (model: Model<any>) => boolean;
	label: string;
}

export interface ParsedModelQuery {
	residualQuery: string;
	predicates: ModelPredicate[];
}

const CHEAP_INPUT_PER_M = 1.0;
const MID_INPUT_PER_M = 5.0;

const CTX_OP_RE = /^(>=|<=|>|<|=)?(\d+)([km])?$/i;

function parseCtxValue(raw: string): { op: string; value: number } | null {
	const match = raw.match(CTX_OP_RE);
	if (!match) return null;
	const op = match[1] || "=";
	let value = Number(match[2]);
	const suffix = match[3]?.toLowerCase();
	if (suffix === "k") value *= 1000;
	else if (suffix === "m") value *= 1_000_000;
	if (!Number.isFinite(value)) return null;
	return { op, value };
}

function compareCtx(window: number, op: string, value: number): boolean {
	switch (op) {
		case ">":
			return window > value;
		case "<":
			return window < value;
		case ">=":
			return window >= value;
		case "<=":
			return window <= value;
		default:
			return window === value;
	}
}

function tierFromCost(cost: number): CostTier {
	if (cost <= CHEAP_INPUT_PER_M) return "cheap";
	if (cost <= MID_INPUT_PER_M) return "mid";
	return "exp";
}

/**
 * Parse a query string into free-text and structured filter predicates.
 *
 * Supported tokens (single occurrence; later occurrences override earlier):
 *   r:high | r:on | r:off       — reasoning support
 *   v:on | v:vision | v:image   — vision/image input
 *   $:cheap | $:mid | $:exp     — cost tier (input cost per M tokens)
 *   ctx:>100k | ctx:128000 ...  — context window comparison
 *   p:openai                    — provider id contains
 *
 * Anything else is treated as free text and re-joined into `residualQuery`.
 */
export function parseModelQuery(raw: string): ParsedModelQuery {
	const predicates: ModelPredicate[] = [];
	const residual: string[] = [];
	const tokens = raw.trim().split(/\s+/).filter(Boolean);

	for (const token of tokens) {
		const colon = token.indexOf(":");
		if (colon <= 0 || colon === token.length - 1) {
			residual.push(token);
			continue;
		}
		const key = token.slice(0, colon).toLowerCase();
		const value = token.slice(colon + 1).toLowerCase();

		if (key === "r" || key === "reasoning") {
			if (value === "off" || value === "no" || value === "false") {
				predicates.push({ test: (m) => !m.reasoning, label: `r:off` });
			} else {
				predicates.push({ test: (m) => !!m.reasoning, label: `r:on` });
			}
			continue;
		}

		if (key === "v" || key === "vision" || key === "image") {
			const wantVision = !(value === "off" || value === "no" || value === "false");
			predicates.push({
				test: (m) => (m.input?.includes("image") ?? false) === wantVision,
				label: `v:${wantVision ? "on" : "off"}`,
			});
			continue;
		}

		if (key === "$" || key === "cost") {
			const tier: CostTier =
				value === "cheap" || value === "low"
					? "cheap"
					: value === "mid" || value === "medium"
						? "mid"
						: value === "exp" || value === "expensive" || value === "high"
							? "exp"
							: "cheap";
			predicates.push({
				test: (m) => tierFromCost(m.cost?.input ?? 0) === tier,
				label: `$:${tier}`,
			});
			continue;
		}

		if (key === "ctx" || key === "context") {
			const parsed = parseCtxValue(value);
			if (parsed) {
				predicates.push({
					test: (m) => compareCtx(m.contextWindow ?? 0, parsed.op, parsed.value),
					label: `ctx:${parsed.op === "=" ? "" : parsed.op}${parsed.value}`,
				});
				continue;
			}
		}

		if (key === "p" || key === "provider") {
			predicates.push({
				test: (m) => m.provider.toLowerCase().includes(value),
				label: `p:${value}`,
			});
			continue;
		}

		// Unknown prefix — treat as free text so users can still type things
		// like "model:foo" without surprising filtering.
		residual.push(token);
	}

	return { residualQuery: residual.join(" "), predicates };
}

export function applyModelPredicates(models: Model<any>[], predicates: ModelPredicate[]): Model<any>[] {
	if (predicates.length === 0) return models;
	return models.filter((model) => predicates.every((p) => p.test(model)));
}

export function describePredicates(predicates: ModelPredicate[]): string {
	return predicates.map((p) => p.label).join(" ");
}
