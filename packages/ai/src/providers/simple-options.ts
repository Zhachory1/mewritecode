import type {
	Api,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
} from "../types.js";

// Rough token estimate (~4 chars/token). Deliberately approximate: this only
// feeds the output-budget subtraction below, which is clamped by a safety
// margin and a floor, so small errors are harmless. Not a billing figure.
function estimateStringTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function estimateMessageTokens(message: Message): number {
	let chars = 0;
	if (typeof message.content === "string") {
		chars += message.content.length;
	} else {
		for (const block of message.content) {
			if (block.type === "text") chars += block.text.length;
			else if (block.type === "thinking") chars += block.thinking.length;
			else if (block.type === "toolCall") chars += JSON.stringify(block.arguments).length + block.name.length;
			else if (block.type === "image") chars += 1600; // ~image token approximation
		}
	}
	return Math.ceil(chars / 4);
}

/** Approximate input token count for a request context (system + messages). */
export function estimateContextTokens(context: Context): number {
	let tokens = context.systemPrompt ? estimateStringTokens(context.systemPrompt) : 0;
	for (const message of context.messages) {
		tokens += estimateMessageTokens(message);
	}
	if (context.tools?.length) {
		for (const tool of context.tools) {
			tokens += estimateStringTokens(JSON.stringify(tool));
		}
	}
	return tokens;
}

// When we can't see the context we fall back to the model's own output ceiling
// rather than an arbitrary constant. Minimum output we always leave room for
// even when context is nearly full, and slack to absorb estimate error.
const MIN_OUTPUT_TOKENS = 1024;
const INPUT_ESTIMATE_MARGIN_TOKENS = 4096;

/**
 * Resolve the per-request output token budget.
 *
 * The model's own `maxTokens` is the ceiling. When a request context is
 * available and the model advertises a context window, we additionally cap so
 * `input + output` fits the window (a hard API requirement for Anthropic,
 * Bedrock and Gemini), leaving a small margin for estimate error and never
 * dropping below MIN_OUTPUT_TOKENS. This replaces a flat 32k clamp that both
 * throttled large-output models and ignored the window constraint entirely.
 */
export function resolveMaxOutputTokens(model: Model<Api>, context?: Context): number {
	const ceiling = model.maxTokens;
	if (!context || !model.contextWindow) return ceiling;
	const inputEstimate = estimateContextTokens(context) + INPUT_ESTIMATE_MARGIN_TOKENS;
	const remaining = model.contextWindow - inputEstimate;
	return Math.max(MIN_OUTPUT_TOKENS, Math.min(ceiling, remaining));
}

export function buildBaseOptions(
	model: Model<Api>,
	options?: SimpleStreamOptions,
	apiKey?: string,
	context?: Context,
): StreamOptions {
	return {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens || resolveMaxOutputTokens(model, context),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
	};
}

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh"> | undefined {
	return effort === "xhigh" ? "high" : effort;
}

export function adjustMaxTokensForThinking(
	baseMaxTokens: number,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };

	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel)!;
	let thinkingBudget = budgets[level]!;
	// `baseMaxTokens` already comes from resolveMaxOutputTokens: the model ceiling
	// capped so input + output fits the context window. Anthropic counts thinking
	// tokens *within* max_tokens, so the budget is carved from this cap — never
	// added on top (which would push max_tokens past the window and 400 the
	// request when context is nearly full).
	const maxTokens = Math.min(baseMaxTokens, modelMaxTokens);

	if (thinkingBudget > maxTokens - minOutputTokens) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}

	return { maxTokens, thinkingBudget };
}
