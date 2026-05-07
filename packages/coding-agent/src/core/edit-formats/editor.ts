/**
 * WS8: editor-side formats for the architect/editor split.
 *
 * In `editor-diff` / `editor-whole`, the architect (planning) model emits
 * a high-level natural-language plan; a downstream editor model translates
 * the plan into concrete file edits using either `diff` or `whole`.
 *
 * The split lets us route reasoning to a high-end model and dispatch the
 * mechanical translation to a cheap, fast one. Aider reports +5–10pp pass@1
 * on its bench by pairing GPT-4 architect + Claude 3 Opus editor.
 */

import { diffFormat } from "./diff.js";
import type { EditFormat } from "./types.js";
import { wholeFormat } from "./whole.js";

const EDITOR_DIFF_PROMPT = `You are the EDITOR in an architect/editor pair.

You receive a plan from the architect describing the changes to make. Your
job is to translate the plan into concrete file edits using SEARCH/REPLACE
blocks (the DIFF format).

${diffFormat.systemPromptFragment}`;

const EDITOR_WHOLE_PROMPT = `You are the EDITOR in an architect/editor pair.

You receive a plan from the architect describing the changes to make. Your
job is to translate the plan into concrete file edits by emitting the
COMPLETE new contents of each modified file.

${wholeFormat.systemPromptFragment}`;

export const editorDiffFormat: EditFormat = {
	name: "editor-diff",
	systemPromptFragment: EDITOR_DIFF_PROMPT,
	parse: diffFormat.parse,
};

export const editorWholeFormat: EditFormat = {
	name: "editor-whole",
	systemPromptFragment: EDITOR_WHOLE_PROMPT,
	parse: wholeFormat.parse,
};
