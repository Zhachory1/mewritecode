/**
 * WS8: Edit-format interface.
 *
 * Edit formats describe HOW the model emits file modifications.
 * Each format defines a system-prompt fragment teaching the model the wire
 * format, plus a parser that extracts file edits from the assistant's reply.
 *
 * Formats (Aider's taxonomy):
 *   - whole          send the entire new file content
 *   - diff           SEARCH/REPLACE blocks with file fences (Aider's default)
 *   - diff-fenced    SEARCH/REPLACE inside a single fenced block (gemini-style)
 *   - udiff          unified diff hunks
 *   - editor-diff    architect/editor split — editor runs `diff`
 *   - editor-whole   architect/editor split — editor runs `whole`
 */

export type EditFormatName = "whole" | "diff" | "diff-fenced" | "udiff" | "editor-diff" | "editor-whole";

export interface FileEdit {
	file: string;
	/**
	 * "whole" — `content` is the new file body.
	 * "patch" — `before`/`after` define a SEARCH/REPLACE pair.
	 * "udiff" — `udiff` carries the raw unified-diff text.
	 */
	mode: "whole" | "patch" | "udiff";
	content?: string;
	before?: string;
	after?: string;
	udiff?: string;
}

export interface ParseEditsResult {
	edits: FileEdit[];
	/** Free-form text outside the edit blocks. Used to keep the LLM chatty. */
	prose: string;
	/** Recovered from malformed input — parser kept what it could. */
	warnings: string[];
}

export interface EditFormat {
	name: EditFormatName;
	/** Short prompt fragment teaching the model the wire format. */
	systemPromptFragment: string;
	/** Pull file edits out of an assistant reply. */
	parse(reply: string): ParseEditsResult;
}
