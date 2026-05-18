import type { TUI } from "@caveman-code/tui";
import { promptSecret, type SecretPromptOptions } from "./secret-prompt.js";

export interface SudoPromptOptions extends Omit<SecretPromptOptions, "auditLabel"> {
	tool: string;
}

/**
 * Sudo-style secret prompt. Always audits to ~/.cave/audit.log under a
 * dedicated label so privilege escalations are traceable.
 */
export async function promptSudo(tui: TUI, opts: SudoPromptOptions): Promise<string | null> {
	const auditLabel = `sudo:${opts.tool}`;
	return promptSecret(tui, {
		prompt: opts.prompt,
		hint: opts.hint,
		auditLabel,
		auditPath: opts.auditPath,
		maskChar: opts.maskChar,
	});
}
