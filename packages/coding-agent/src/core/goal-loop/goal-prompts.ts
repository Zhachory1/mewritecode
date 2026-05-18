/**
 * Builds the per-iteration prompt fed to `caveman -p`. Goal text comes from the
 * durable GOAL.md body. SUMMARY.md (rolling, ≤2KB) injects what previous
 * iterations did. Anti-cheat clause and sentinel rule are appended verbatim.
 */

import { DEFAULT_COMPLETION_SENTINEL } from "./goal-state.js";

export interface BuildIterPromptInput {
	goalBody: string;
	summary: string;
	iteration: number;
	maxIterations: number;
	sentinel: string;
}

export const SENTINEL_GUIDE = (sentinel: string): string =>
	`## Completion sentinel

When (and ONLY when) every requirement above is unequivocally satisfied AND verified by tools (tests pass, files exist, etc.), output the literal token:

${sentinel}

on its own line as the last thing in your response. Do not output the sentinel under any other circumstance — including frustration, fatigue, or to escape the loop. The driver will only accept the sentinel as completion proof; lying wastes another iteration.`;

export const buildIterPrompt = (input: BuildIterPromptInput): string => {
	const { goalBody, summary, iteration, maxIterations, sentinel } = input;
	const summarySection = summary.trim()
		? `## Progress so far (rolling summary from previous iteration)\n\n${summary.trim()}\n`
		: "## Progress so far\n\n(no prior iterations — this is the first attempt)\n";
	return `You are running inside an autonomous goal loop. This is iteration ${iteration} of at most ${maxIterations}.

## Goal

${goalBody.trim()}

${summarySection}
## Your job this iteration

1. Read the current state of the working directory and any tests/build output to ground yourself.
2. Make concrete forward progress on the goal — write code, run tests, fix bugs.
3. End your response with a short progress note (3-5 lines): what you did this iteration, what is still left, blockers if any. The driver appends this to SUMMARY.md for the next iteration.
4. If — and only if — the goal is fully complete and verified, output the completion sentinel.

${SENTINEL_GUIDE(sentinel)}
`;
};

export const extractSummaryTail = (assistantText: string, maxBytes = 1800): string => {
	const text = assistantText.trim();
	if (text.length <= maxBytes) return text;
	return text.slice(text.length - maxBytes);
};

export const detectSentinel = (assistantText: string, sentinel = DEFAULT_COMPLETION_SENTINEL): boolean => {
	const lines = assistantText.split(/\r?\n/);
	const tail = lines.slice(-200).join("\n");
	return tail.includes(sentinel);
};
