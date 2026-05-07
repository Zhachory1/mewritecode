/**
 * `/plan` slash command — flip the active session into read-only plan mode.
 *
 * Forms:
 *   /plan                       toggle plan mode on
 *   /plan off                   leave plan mode (alias of /act without follow-up)
 *   /plan status                show current chat mode
 *   /plan show                  show saved plan
 *   /plan <free-form prompt>    flip into plan mode AND submit prompt as-is
 *
 * In plan mode the model sees only file-discovery tools (read/grep/find/ls)
 * and is instructed to produce a written plan. The user reviews and types
 * `/act` to flip back to edit mode (see slash-commands/act.ts).
 */

import type { ChatMode } from "../chat-modes/plan.js";
import { getPlanFilePath, readPlan } from "../plans.js";

export interface PlanCommandIO {
	getChatMode: () => ChatMode;
	setChatMode: (mode: ChatMode) => void;
	/** Stable id for the active session, used to slug the plan file. */
	sessionId: string;
}

export interface PlanCommandResult {
	exitCode: number;
	output: string;
	/**
	 * When `/plan <prompt>` is used, this is the prompt the caller should
	 * submit to the session immediately after flipping into plan mode.
	 */
	promptToSend?: string;
}

const SUBCOMMANDS = new Set(["off", "status", "show"]);

export function runPlanCommand(args: string, io: PlanCommandIO): PlanCommandResult {
	const trimmed = args.trim();
	const head = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

	if (head === "off") {
		io.setChatMode("auto");
		return { exitCode: 0, output: "Plan mode: off. Edit tools restored." };
	}
	if (head === "status") {
		const mode = io.getChatMode();
		const path = getPlanFilePath(io.sessionId);
		const plan = readPlan(io.sessionId);
		const planLine = plan ? `\nSaved plan: ${path}` : "";
		return { exitCode: 0, output: `chat mode: ${mode}${planLine}` };
	}
	if (head === "show") {
		const plan = readPlan(io.sessionId);
		if (!plan) return { exitCode: 0, output: "No saved plan for this session." };
		return { exitCode: 0, output: `Saved plan (${getPlanFilePath(io.sessionId)}):\n\n${plan}` };
	}

	io.setChatMode("plan");
	if (trimmed && !SUBCOMMANDS.has(head)) {
		return {
			exitCode: 0,
			output: `Plan mode: on. Submitting your prompt — agent will plan, not edit. /act to execute.`,
			promptToSend: trimmed,
		};
	}
	return {
		exitCode: 0,
		output: `Plan mode: on. Read-only tools active. Plan will save to ${getPlanFilePath(io.sessionId)}.\nAsk the agent to plan a change, then type \`/act\` to execute.`,
	};
}
