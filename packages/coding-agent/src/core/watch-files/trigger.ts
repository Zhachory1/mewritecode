/**
 * WS18 — Watch-Files trigger dispatcher.
 *
 * When a file change is detected:
 *  1. Parse mewrite comments (fire/qa/context).
 *  2. Accumulate "context" comments into a running buffer.
 *  3. On "fire" (mewrite!) — build a prompt from accumulated context + surrounding
 *     lines, dispatch to the provided agentRun callback, remove the trigger
 *     comment from disk on success.
 *  4. On "qa" (mewrite?) — same but read-only (no file modification).
 *  5. Cycle protection — ignore files the agent itself just modified.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { type MewriteComment, parseMewriteComments, removeLine, surroundingLines } from "./comment-parser.js";

export interface TriggerContext {
	/** Accumulated "mewrite" context comments (cleared after each fire/qa). */
	accumulatedContext: string[];
}

export function createTriggerContext(): TriggerContext {
	return { accumulatedContext: [] };
}

/**
 * Signature for the agent dispatch function.
 * Returns the agent's response text (or throws on failure).
 */
export type AgentRunFn = (prompt: string, filePath: string, isReadOnly: boolean) => Promise<string>;

export interface TriggerOptions {
	/** Number of surrounding lines to include in the prompt. Default 20. */
	contextRadius?: number;
}

/**
 * Process a single changed file:
 *  - Parse mewrite comments.
 *  - Accumulate context markers.
 *  - Dispatch fire/qa triggers to agentRun.
 *  - Remove fire comment from disk on success.
 *
 * Returns true if at least one fire or qa trigger was dispatched.
 */
export async function processTriggers(
	filePath: string,
	triggerCtx: TriggerContext,
	agentRun: AgentRunFn,
	options: TriggerOptions = {},
): Promise<boolean> {
	const radius = options.contextRadius ?? 20;

	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		// File may have been deleted between detection and read
		return false;
	}

	const ext = extname(filePath).replace(/^\./, "").toLowerCase();
	const comments = parseMewriteComments(content, ext);

	if (comments.length === 0) return false;

	let didFire = false;

	// We process comments top-to-bottom. Each fire/qa may shift line numbers
	// after a line removal, so we track an offset.
	let lineOffset = 0;

	// Re-read content before each modification to stay in sync
	let currentContent = content;

	for (const comment of comments) {
		if (comment.kind === "context") {
			const contextText = comment.text || `[context from ${filePath}:${comment.line}]`;
			triggerCtx.accumulatedContext.push(contextText);
			continue;
		}

		// fire or qa
		const adjustedLine = comment.line + lineOffset;
		const context = buildPrompt(filePath, adjustedLine, currentContent, comment, triggerCtx, radius);
		const isReadOnly = comment.kind === "qa";

		let response: string;
		try {
			response = await agentRun(context, filePath, isReadOnly);
		} catch (err) {
			process.stderr.write(
				`[mewrite watch] agent error for ${filePath}:${adjustedLine}: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			continue;
		}

		if (!isReadOnly) {
			// Remove the trigger comment from disk
			try {
				currentContent = readFileSync(filePath, "utf8");
				const newContent = removeLine(currentContent, adjustedLine);
				writeFileSync(filePath, newContent, "utf8");
				currentContent = newContent;
				lineOffset -= 1; // one line was removed
			} catch (err) {
				process.stderr.write(
					`[mewrite watch] failed to remove trigger comment from ${filePath}: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			}
		} else {
			// Q&A: print response to stderr
			process.stderr.write(`[mewrite watch] ${filePath}:${adjustedLine} Q&A response:\n${response}\n`);
		}

		// Consumed — clear accumulated context
		triggerCtx.accumulatedContext = [];
		didFire = true;
	}

	return didFire;
}

function buildPrompt(
	filePath: string,
	lineNumber: number,
	content: string,
	comment: MewriteComment,
	triggerCtx: TriggerContext,
	radius: number,
): string {
	const surrounding = surroundingLines(content, lineNumber, radius);
	const surroundingText = surrounding.map((l) => `${l.lineNumber}: ${l.content}`).join("\n");

	const parts: string[] = [];

	parts.push(`File: ${filePath}`);
	parts.push(`Trigger line: ${lineNumber}`);

	if (triggerCtx.accumulatedContext.length > 0) {
		parts.push("\nAccumulated context:");
		for (const ctx of triggerCtx.accumulatedContext) {
			parts.push(`  - ${ctx}`);
		}
	}

	if (comment.text) {
		parts.push(`\nInstruction: ${comment.text}`);
	}

	parts.push(`\nSurrounding source (±${radius} lines):\n\`\`\`\n${surroundingText}\n\`\`\``);

	if (comment.kind === "qa") {
		parts.push("\nThis is a read-only Q&A request. Do not modify any files.");
	}

	return parts.join("\n");
}
