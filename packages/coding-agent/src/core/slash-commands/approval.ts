/**
 * `/approval` slash command — toggle the OPT-IN approval mode (#14).
 *
 * Forms:
 *   /approval            toggle approval mode
 *   /approval on         enable
 *   /approval off        disable
 *   /approval status     show current state
 *
 * Approval mode is ORTHOGONAL to chat mode (plan/edit/auto) — it composes with
 * them rather than replacing them. When ON, writes/bash/destructive/unknown
 * tool calls require interactive human approval before running; reads run free.
 *
 * HONEST FRAMING (surfaced in the command output): this forces a human to review
 * writes/bash — it is accident-prevention, NOT a security perimeter. A
 * determined or already-approved command can still do damage. For real
 * isolation see the enforced sandbox (#46).
 */

export interface ApprovalCommandIO {
	getApprovalMode: () => boolean;
	setApprovalMode: (enabled: boolean) => void;
}

export interface ApprovalCommandResult {
	exitCode: number;
	output: string;
}

const HONEST_NOTE =
	"Note: approval mode forces human review of writes/bash — it is accident-prevention, NOT a security perimeter. For real isolation see the enforced sandbox (#46).";

export function runApprovalCommand(args: string, io: ApprovalCommandIO): ApprovalCommandResult {
	const head = args.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";

	if (head === "status") {
		const on = io.getApprovalMode();
		return { exitCode: 0, output: `Approval mode: ${on ? "on" : "off"}.\n${HONEST_NOTE}` };
	}

	let next: boolean;
	if (head === "on" || head === "true") {
		next = true;
	} else if (head === "off" || head === "false") {
		next = false;
	} else if (head === "") {
		next = !io.getApprovalMode();
	} else {
		return {
			exitCode: 1,
			output: `Unknown argument "${head}". Usage: /approval [on|off|status]`,
		};
	}

	io.setApprovalMode(next);
	if (next) {
		return {
			exitCode: 0,
			output: `Approval mode: ON. Writes/bash/destructive/unknown tools now prompt before running; reads run free.\n${HONEST_NOTE}`,
		};
	}
	return {
		exitCode: 0,
		output: "Approval mode: OFF. Autopilot restored — tools run without prompting.",
	};
}
