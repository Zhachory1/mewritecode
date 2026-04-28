// T-018: Linux Landlock sandbox wrapper with kernel 5.13 detection.
//
// Landlock requires kernel 5.13+. On older kernels we fall back to
// a permissive wrapper and emit a one-time warning at startup.
//
// WS3 extension: `landlockFromPolicy()` accepts a SandboxPolicy IR. The real
// implementation will spawn `bwrap` (bubblewrap) with bind mounts derived from
// the policy + a Landlock ruleset attached via prctl. Today we ship a marker
// wrapper as a placeholder; tests assert the IR plumbing.
//
// TODO(ws3-linux): replace `wrap()` body with bubblewrap + landlock helper.

import type { SandboxPolicy } from "./policy.js";
import type { SandboxAllow, SandboxProfile, SandboxResult } from "./types.js";

export interface KernelInfo {
	major: number;
	minor: number;
}

export function parseKernelVersion(release: string): KernelInfo {
	const m = release.match(/^(\d+)\.(\d+)/);
	if (!m) return { major: 0, minor: 0 };
	return { major: Number.parseInt(m[1], 10), minor: Number.parseInt(m[2], 10) };
}

export function supportsLandlock(info: KernelInfo): boolean {
	return info.major > 5 || (info.major === 5 && info.minor >= 13);
}

/** Detected once at startup and cached. Returns undefined on non-Linux. */
let CACHED_SUPPORT: boolean | undefined;
export function detectLandlockSupport(platform: string, release: string): boolean {
	if (platform !== "linux") {
		CACHED_SUPPORT = false;
		return false;
	}
	if (CACHED_SUPPORT !== undefined) return CACHED_SUPPORT;
	CACHED_SUPPORT = supportsLandlock(parseKernelVersion(release));
	return CACHED_SUPPORT;
}

/** Test-only reset. */
export function __resetLandlockCache(): void {
	CACHED_SUPPORT = undefined;
}

/** WS3: build a landlock-bubblewrap wrapper from a SandboxPolicy IR. */
export function landlockFromPolicy(policy: SandboxPolicy, supported = true): SandboxResult {
	if (policy.kind === "danger_full_access") {
		return {
			profile: {
				kind: "permissive",
				workdir: policy.workdir,
				allow: {},
				permissiveReason: "danger_full_access",
			},
			wrap: (command) => command,
		};
	}
	const allow: SandboxAllow =
		policy.kind === "workspace_write" ? { writes: policy.extraWritableRoots, network: policy.allowAllNetwork } : {};
	return landlockSandbox(policy.workdir, allow, supported);
}

export function landlockSandbox(workdir: string, allow: SandboxAllow = {}, supported = true): SandboxResult {
	const profile: SandboxProfile = {
		kind: supported ? "landlock" : "permissive",
		workdir,
		allow,
		permissiveReason: supported ? undefined : "kernel<5.13: landlock unavailable",
	};
	return {
		profile,
		wrap(command: string): string {
			if (!supported) return command;
			// Real impl would use prctl(PR_SET_NO_NEW_PRIVS) + landlock syscalls via
			// a small C helper. For now we mark the boundary with a prefix the
			// runner unwraps at execution time.
			return `CAVE_LANDLOCK_WORKDIR='${workdir}' ${command}`;
		},
	};
}
