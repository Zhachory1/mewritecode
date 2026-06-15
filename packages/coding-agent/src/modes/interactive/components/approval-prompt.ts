/**
 * Approval prompt overlay for OPT-IN approval mode (#14).
 *
 * Shown when approval mode is ON and the agent wants to run a non-read tool. The
 * user picks Approve once / Approve for session / Deny. The promise returned by
 * `showApprovalPrompt` resolves with that choice and the gate acts on it.
 *
 * HONEST FRAMING (rendered in the dialog): this forces a human to review the
 * action — it is accident-prevention, NOT a security perimeter. An approved
 * command can still do damage. Real isolation is the enforced sandbox (#46).
 */

import { Container, getKeybindings, type OverlayHandle, Spacer, Text, type TUI } from "@juliusbrussee/caveman-tui";
import type { ApprovalDecision } from "../../../core/agent-session.js";
import type { RiskTier } from "../../../core/approval-policy.js";
import { theme } from "../theme/theme.js";

export interface ApprovalPromptOptions {
	toolName: string;
	tier: RiskTier;
	/** One-line summary of what the tool will do (e.g. the bash command). */
	summary?: string;
	/**
	 * LOW-3: when the loop is aborted (programmatic `session.abort()`) while this
	 * dialog is open, dismiss it and resolve to the safe choice (deny) so the loop
	 * never hangs waiting on a prompt no one can answer.
	 */
	signal?: AbortSignal;
}

interface InternalOpts extends ApprovalPromptOptions {
	onChoose: (decision: ApprovalDecision) => void;
}

/**
 * Build the choice list. The "session" label is made HONEST about its coarse
 * semantics: approving for session unlocks ALL future calls of this tool for the
 * rest of the session (e.g. every future bash call, including `rm -rf`), not just
 * this one. We keep the coarse behavior (fine for a speed-bump) but say so.
 */
export function buildChoices(toolName: string): ReadonlyArray<{ value: ApprovalDecision; label: string }> {
	return [
		{ value: "once", label: "Approve once" },
		{ value: "session", label: `Approve for session (all ${toolName} calls)` },
		{ value: "deny", label: "Deny" },
	];
}

function verbForTier(tier: RiskTier): string {
	switch (tier) {
		case "exec":
			return "run a shell command";
		case "destructive":
			return "run a possibly-DESTRUCTIVE shell command";
		default:
			return "make changes";
	}
}

export class ApprovalPromptComponent extends Container {
	private selectedIndex = 0;
	private listContainer: Container;
	private readonly choices: ReadonlyArray<{ value: ApprovalDecision; label: string }>;

	constructor(private readonly opts: InternalOpts) {
		super();
		this.choices = buildChoices(opts.toolName);
		const danger = opts.tier === "destructive";
		const borderColor = danger ? "error" : "warning";

		this.addChild(new Text(theme.fg(borderColor, doubleBorderTop()), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(`${danger ? "⛔" : "▸"}  ${theme.bold(`${opts.toolName} wants to ${verbForTier(opts.tier)}`)}`, 1, 0),
		);
		if (opts.summary) {
			this.addChild(new Text(theme.fg("muted", truncate(opts.summary, 80)), 3, 0));
		}
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					"Human review, NOT a security perimeter — an approved action can still do damage (#46 = sandbox).",
				),
				1,
				0,
			),
		);
		this.addChild(new Text(theme.fg("dim", "↑/↓ select · Enter confirm · A once · S session · D/Esc deny"), 1, 0));
		this.addChild(new Text(theme.fg(borderColor, doubleBorderBottom()), 0, 0));
		this.updateList();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.selectedIndex = Math.min(this.choices.length - 1, this.selectedIndex + 1);
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.opts.onChoose(this.choices[this.selectedIndex].value);
			return;
		}
		if (data === "a" || data === "A") {
			this.opts.onChoose("once");
			return;
		}
		if (data === "s" || data === "S") {
			this.opts.onChoose("session");
			return;
		}
		if (data === "d" || data === "D") {
			this.opts.onChoose("deny");
			return;
		}
		if (kb.matches(data, "tui.select.cancel") || data === "\x03") {
			// Cancel / Ctrl-C = the safe choice = deny.
			this.opts.onChoose("deny");
		}
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.choices.length; i++) {
			const c = this.choices[i];
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "▸ ") : "  ";
			const label = isSelected ? theme.fg("accent", c.label) : theme.fg("text", c.label);
			this.listContainer.addChild(new Text(`${prefix}${label}`, 1, 0));
		}
	}
}

/**
 * Show the approval overlay and resolve with the user's decision. Defaults to
 * `deny` on cancel — the safe outcome.
 */
export async function showApprovalPrompt(tui: TUI, opts: ApprovalPromptOptions): Promise<ApprovalDecision> {
	return new Promise((resolve) => {
		let handle: OverlayHandle | null = null;
		let onAbort: (() => void) | undefined;
		const finish = (decision: ApprovalDecision): void => {
			if (onAbort && opts.signal) opts.signal.removeEventListener("abort", onAbort);
			handle?.hide();
			resolve(decision);
		};
		// LOW-3: if already aborted, deny immediately without showing the dialog.
		if (opts.signal?.aborted) {
			resolve("deny");
			return;
		}
		const component = new ApprovalPromptComponent({ ...opts, onChoose: finish });
		handle = tui.showOverlay(component, { anchor: "center" });
		handle.focus();
		// LOW-3: abort while the dialog is open → dismiss + resolve deny.
		if (opts.signal) {
			onAbort = () => finish("deny");
			opts.signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function doubleBorderTop(): string {
	return "╔════════════════════════════════════════════════╗";
}

function doubleBorderBottom(): string {
	return "╚════════════════════════════════════════════════╝";
}
