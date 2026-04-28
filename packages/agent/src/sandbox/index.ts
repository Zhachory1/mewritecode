export * from "./landlock.js";
export * from "./policy.js";
export * from "./proxy.js";
export * from "./seatbelt.js";
export * from "./types.js";
export * from "./windows.js";

import { detectLandlockSupport, landlockFromPolicy, landlockSandbox } from "./landlock.js";
import type { SandboxPolicy } from "./policy.js";
import { seatbeltFromPolicy, seatbeltSandbox } from "./seatbelt.js";
import type { SandboxAllow, SandboxResult } from "./types.js";
import { WINDOWS_UNSUPPORTED_WARNING, windowsFromPolicy, windowsSandbox } from "./windows.js";

export interface SandboxSelection {
	sandbox: SandboxResult;
	warning?: string;
}

/** Pick the right sandbox for the current platform. */
export function selectSandbox(
	platform: NodeJS.Platform,
	release: string,
	workdir: string,
	allow: SandboxAllow = {},
): SandboxSelection {
	if (platform === "darwin") {
		return { sandbox: seatbeltSandbox(workdir, allow) };
	}
	if (platform === "linux") {
		const supported = detectLandlockSupport(platform, release);
		return {
			sandbox: landlockSandbox(workdir, allow, supported),
			warning: supported ? undefined : "cave: landlock unsupported (kernel<5.13) — running permissive",
		};
	}
	if (platform === "win32") {
		return { sandbox: windowsSandbox(workdir, allow), warning: WINDOWS_UNSUPPORTED_WARNING };
	}
	return {
		sandbox: windowsSandbox(workdir, allow),
		warning: `cave: unknown platform ${platform} — running permissive`,
	};
}

/**
 * WS3: pick the right OS-level sandbox for a given SandboxPolicy IR.
 *
 * This is the entry point used by `cave sandbox -- <cmd>` and by tools that
 * route through the policy reducer.
 */
export function selectSandboxFromPolicy(
	platform: NodeJS.Platform,
	release: string,
	policy: SandboxPolicy,
): SandboxSelection {
	if (platform === "darwin") {
		return { sandbox: seatbeltFromPolicy(policy) };
	}
	if (platform === "linux") {
		const supported = detectLandlockSupport(platform, release);
		return {
			sandbox: landlockFromPolicy(policy, supported),
			warning: supported ? undefined : "cave: landlock unsupported (kernel<5.13) — running permissive",
		};
	}
	if (platform === "win32") {
		return { sandbox: windowsFromPolicy(policy), warning: WINDOWS_UNSUPPORTED_WARNING };
	}
	return {
		sandbox: windowsFromPolicy(policy),
		warning: `cave: unknown platform ${platform} — running permissive`,
	};
}
