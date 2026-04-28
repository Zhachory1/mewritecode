// T-019: Windows unsupported-sandbox warning, runs permissive.
//
// WS3 extension: `windowsFromPolicy()` accepts a SandboxPolicy IR but still
// runs permissive. TODO(ws3-windows): swap to Restricted Tokens via Win32
// CreateRestrictedToken + Job Objects with UI restrictions.

import type { SandboxPolicy } from "./policy.js";
import type { SandboxAllow, SandboxProfile, SandboxResult } from "./types.js";

export const WINDOWS_UNSUPPORTED_WARNING =
	"cave: bash sandbox unsupported on Windows — running permissive. " +
	"Do not run untrusted code. No Job Objects or AppContainer is used.";

export function windowsSandbox(workdir: string, allow: SandboxAllow = {}): SandboxResult {
	const profile: SandboxProfile = {
		kind: "permissive",
		workdir,
		allow,
		permissiveReason: "windows unsupported",
	};
	return {
		profile,
		wrap(command: string): string {
			return command;
		},
	};
}

export function windowsFromPolicy(policy: SandboxPolicy): SandboxResult {
	const allow: SandboxAllow =
		policy.kind === "workspace_write" ? { writes: policy.extraWritableRoots, network: policy.allowAllNetwork } : {};
	return windowsSandbox(policy.workdir, allow);
}
