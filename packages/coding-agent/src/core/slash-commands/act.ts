/**
 * `/act` slash command — flip out of plan mode into edit mode and continue.
 *
 * Companion to `/plan` (see slash-commands/plan.ts). Used when the user has
 * reviewed the agent's plan and wants the agent to execute it. Flips chat
 * mode back to "auto" so the full tool surface is restored on the next turn.
 */

import type { ChatMode } from "../chat-modes/plan.js";
import { getPlanFilePath, readPlan } from "../plans.js";

export interface ActCommandIO {
	setChatMode: (mode: ChatMode) => void;
	/** Stable id for the active session, used to look up the saved plan. */
	sessionId: string;
	/**
	 * Optional follow-up injector. When provided and a saved plan exists, the
	 * plan is automatically queued as the next user message so the model
	 * executes it without the user having to retype "go" / "do it".
	 */
	enqueueFollowUp?: (text: string) => void;
}

export interface ActCommandResult {
	exitCode: number;
	output: string;
}

export function runActCommand(_args: string, io: ActCommandIO): ActCommandResult {
	io.setChatMode("auto");
	const plan = readPlan(io.sessionId);
	if (plan && io.enqueueFollowUp) {
		io.enqueueFollowUp(`Execute the plan you just produced. For reference:\n\n${plan}`);
		return {
			exitCode: 0,
			output: `Edit mode restored. Plan from ${getPlanFilePath(io.sessionId)} queued as next prompt.`,
		};
	}
	if (plan) {
		return {
			exitCode: 0,
			output: `Edit mode restored. Saved plan at ${getPlanFilePath(io.sessionId)} — send a prompt to execute.`,
		};
	}
	return {
		exitCode: 0,
		output: "Edit mode restored. Send a follow-up prompt and the agent will execute the plan.",
	};
}
