/**
 * Chapters — auto-fold transcript turns by detected intent.
 *
 * The TUI keeps a flat history; chapters group consecutive turns that share
 * a detected intent ("debug", "refactor", "test", "explain", …) into a
 * single foldable unit. Detection is heuristic (keyword + tool-pattern) so
 * the UX stays predictable and predictable-feeling cheap.
 */

export type Intent = "implement" | "debug" | "refactor" | "test" | "explain" | "review" | "plan" | "memory" | "other";

export interface Turn {
	id: string;
	role: "user" | "assistant" | "tool";
	text: string;
	tools?: string[];
	timestamp: number;
}

export interface Chapter {
	id: string;
	intent: Intent;
	title: string;
	turns: Turn[];
	startedAt: number;
	endedAt: number;
	folded: boolean;
}

interface IntentRule {
	intent: Intent;
	keywords: RegExp;
	tools?: RegExp;
}

const RULES: IntentRule[] = [
	{
		intent: "debug",
		keywords:
			/\b(bug|crash|stack trace|null|undefined|reproduce|fail(ed|ing)?|exception|TypeError|RangeError|why is|why does|broken)\b/i,
	},
	{ intent: "test", keywords: /\b(test|spec|vitest|jest|node:test|coverage|assertion)s?\b/i, tools: /Bash|Test/ },
	{ intent: "refactor", keywords: /\b(refactor|rename|extract|inline|deduplicat|cleanup|tidy|simplif|reorganiz)/i },
	{
		intent: "implement",
		keywords: /\b(implement|add|create|build|wire|hook up|introduce|scaffold)\b/i,
		tools: /Edit|Write/,
	},
	{ intent: "explain", keywords: /\b(explain|what does|how does|walk me through|tell me about|what is)\b/i },
	{ intent: "review", keywords: /\b(review|critique|feedback|audit|lgtm|nit:)/i },
	{ intent: "plan", keywords: /\b(plan|outline|strategy|approach|design|architecture|sketch)\b/i },
	{ intent: "memory", keywords: /\b(remember|memory|memorize|recall|forget)\b/i },
];

/**
 * Classify a single turn into an intent. The first matching rule wins; ties
 * are broken by rule order, which mirrors how a user perceives priority
 * (test/debug/refactor before generic implement).
 */
export function detectIntent(turn: Turn): Intent {
	for (const rule of RULES) {
		if (rule.keywords.test(turn.text)) return rule.intent;
		if (rule.tools && turn.tools && turn.tools.some((t) => rule.tools?.test(t))) return rule.intent;
	}
	return "other";
}

/**
 * Group a turn stream into chapters. Consecutive same-intent turns merge;
 * tool-only turns inherit the previous user/assistant intent so they don't
 * fragment a chapter.
 */
export function groupTurnsIntoChapters(turns: Turn[]): Chapter[] {
	const out: Chapter[] = [];
	let current: Chapter | undefined;
	let lastNonToolIntent: Intent | undefined;

	for (const turn of turns) {
		let intent: Intent;
		if (turn.role === "tool" && lastNonToolIntent) {
			intent = lastNonToolIntent;
		} else {
			intent = detectIntent(turn);
			if (turn.role !== "tool") lastNonToolIntent = intent;
		}

		if (current && current.intent === intent) {
			current.turns.push(turn);
			current.endedAt = turn.timestamp;
		} else {
			current = {
				id: `ch-${out.length + 1}`,
				intent,
				title: titleForIntent(intent, turn),
				turns: [turn],
				startedAt: turn.timestamp,
				endedAt: turn.timestamp,
				// Fold every chapter except the last by default; the renderer
				// flips the most recent open after grouping.
				folded: true,
			};
			out.push(current);
		}
	}

	if (out.length > 0) out[out.length - 1].folded = false;
	return out;
}

function titleForIntent(intent: Intent, firstTurn: Turn): string {
	const summary = firstTurn.text.replace(/\s+/g, " ").trim().slice(0, 60);
	const prefix = INTENT_LABELS[intent];
	return summary.length > 0 ? `${prefix}: ${summary}` : prefix;
}

const INTENT_LABELS: Record<Intent, string> = {
	implement: "Implement",
	debug: "Debug",
	refactor: "Refactor",
	test: "Test",
	explain: "Explain",
	review: "Review",
	plan: "Plan",
	memory: "Memory",
	other: "Notes",
};

/** Toggle a chapter's folded state. Returns a new array (immutable). */
export function toggleChapter(chapters: Chapter[], id: string): Chapter[] {
	return chapters.map((c) => (c.id === id ? { ...c, folded: !c.folded } : c));
}

export const intentLabel = (intent: Intent): string => INTENT_LABELS[intent];
