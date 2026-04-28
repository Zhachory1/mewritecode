// T-016, T-017: macOS Seatbelt sandbox profile for bash tool.
//
// Emits a sandbox-exec .sb profile that:
// - Denies writes outside workdir
// - Denies network by default
// - Denies reads of sensitive HOME paths (.ssh, .aws, .gnupg, .config)
// - Allows reads and writes within workdir
//
// The wrap() function returns a `sandbox-exec -p <inline-profile> sh -c '<cmd>'`
// invocation. Real execution is the caller's job; tests assert the produced
// profile bytes.
//
// WS3 extension: `seatbeltFromPolicy()` accepts a SandboxPolicy IR and emits a
// dynamic SBPL that mirrors the policy's reversibility surface.

import type { SandboxPolicy } from "./policy.js";
import type { SandboxAllow, SandboxProfile, SandboxResult } from "./types.js";

const SENSITIVE_HOME_PATHS = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gcloud", "~/.netrc"];

function esc(path: string): string {
	return path.replace(/"/g, '\\"');
}

export function buildSeatbeltProfile(workdir: string, allow: SandboxAllow): string {
	const lines: string[] = [
		"(version 1)",
		"(deny default)",
		"(allow process-fork)",
		"(allow process-exec)",
		"(allow signal (target self))",
		"(allow sysctl-read)",
		"(allow mach-lookup)",
		"(allow file-read*)",
		// Start by allowing writes under the workdir
		`(allow file-write* (subpath "${esc(workdir)}"))`,
	];
	for (const path of allow.writes ?? []) {
		lines.push(`(allow file-write* (subpath "${esc(path)}"))`);
	}
	// Explicitly deny sensitive home paths (reads too, not just writes).
	for (const sensitive of SENSITIVE_HOME_PATHS) {
		lines.push(`(deny file-read* (subpath "${esc(sensitive)}"))`);
		lines.push(`(deny file-write* (subpath "${esc(sensitive)}"))`);
	}
	// Network: deny by default unless allow.network.
	if (allow.network) {
		lines.push("(allow network*)");
	} else {
		lines.push("(deny network*)");
	}
	return lines.join("\n");
}

export function seatbeltSandbox(workdir: string, allow: SandboxAllow = {}): SandboxResult {
	const profile: SandboxProfile = { kind: "seatbelt", workdir, allow };
	const sbProfile = buildSeatbeltProfile(workdir, allow);
	return {
		profile,
		wrap(command: string): string {
			const escapedProfile = sbProfile.replace(/'/g, "'\\''");
			const escapedCmd = command.replace(/'/g, "'\\''");
			return `sandbox-exec -p '${escapedProfile}' sh -c '${escapedCmd}'`;
		},
	};
}

/**
 * WS3: build an SBPL profile from a SandboxPolicy IR.
 *
 * Each policy variant maps to a distinct file-write / network surface:
 * - read_only           : (deny default), file-read* allowed, no writes, no net
 * - workspace_write     : writes under workdir + extraWritableRoots, net only
 *                         if allowAllNetwork (proxy handles per-host filtering)
 * - danger_full_access  : (allow default) — break-glass, equivalent to no sandbox
 */
export function buildSeatbeltProfileFromPolicy(policy: SandboxPolicy): string {
	if (policy.kind === "danger_full_access") {
		return ["(version 1)", "(allow default)"].join("\n");
	}

	const lines: string[] = [
		"(version 1)",
		"(deny default)",
		"(allow process-fork)",
		"(allow process-exec)",
		"(allow signal (target self))",
		"(allow sysctl-read)",
		"(allow mach-lookup)",
		"(allow file-read*)",
	];

	if (policy.kind === "workspace_write") {
		lines.push(`(allow file-write* (subpath "${esc(policy.workdir)}"))`);
		for (const root of policy.extraWritableRoots) {
			lines.push(`(allow file-write* (subpath "${esc(root)}"))`);
		}
	}

	for (const sensitive of SENSITIVE_HOME_PATHS) {
		lines.push(`(deny file-read* (subpath "${esc(sensitive)}"))`);
		lines.push(`(deny file-write* (subpath "${esc(sensitive)}"))`);
	}

	if (policy.kind === "workspace_write" && policy.allowAllNetwork) {
		lines.push("(allow network*)");
	} else {
		lines.push("(deny network*)");
	}

	return lines.join("\n");
}

export function seatbeltFromPolicy(policy: SandboxPolicy): SandboxResult {
	const sbProfile = buildSeatbeltProfileFromPolicy(policy);
	const profile: SandboxProfile = {
		kind: policy.kind === "danger_full_access" ? "permissive" : "seatbelt",
		workdir: policy.workdir,
		allow: policyToAllow(policy),
		permissiveReason: policy.kind === "danger_full_access" ? "danger_full_access" : undefined,
	};
	return {
		profile,
		wrap(command: string): string {
			const escapedProfile = sbProfile.replace(/'/g, "'\\''");
			const escapedCmd = command.replace(/'/g, "'\\''");
			return `sandbox-exec -p '${escapedProfile}' sh -c '${escapedCmd}'`;
		},
	};
}

function policyToAllow(policy: SandboxPolicy): SandboxAllow {
	if (policy.kind === "workspace_write") {
		return {
			writes: policy.extraWritableRoots,
			network: policy.allowAllNetwork,
		};
	}
	return {};
}
