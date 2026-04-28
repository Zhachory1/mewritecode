/**
 * WS3: `/sandbox` slash command + `cave sandbox -- <cmd>` utility.
 *
 * `cave sandbox -- <cmd>` is the Codex-style "sandbox-as-utility" surface:
 * users can run any shell command inside cave's policy IR, regardless of
 * whether they're inside the agent loop. This is the parity feature with
 * Codex's `codex sandbox` and Aider's `--auto-test`.
 *
 * Behind a flag for the first 2 weeks: `cave --sandbox=experimental` (or env
 * var `CAVE_SANDBOX_EXPERIMENTAL=1`). Per the WS3 plan risk-mitigation, the
 * full sandbox is only routed-through-tools after 1k internal hours of
 * validation. Until then it's an opt-in utility.
 */

import { spawnSync } from "node:child_process";
import { release } from "node:os";
import { defaultPolicyForMode, type PermissionMode, type SandboxPolicy, selectSandboxFromPolicy } from "@cave/agent";

export interface SandboxRunOptions {
	/** Permission mode → drives the default policy. */
	mode?: PermissionMode;
	/** Override the default policy entirely. */
	policy?: SandboxPolicy;
	/** Override workdir (defaults to process.cwd()). */
	workdir?: string;
	/** Hosts to allowlist when policy is workspace_write. */
	allowedHosts?: string[];
	/** Allow-all-network (proxy disabled). */
	allowAllNetwork?: boolean;
	/** Extra writable roots when policy is workspace_write. */
	extraWritableRoots?: string[];
}

export interface SandboxRunResult {
	exitCode: number;
	wrappedCommand: string;
	policy: SandboxPolicy;
	warning?: string;
	stderr?: string;
}

/** Build the SandboxPolicy that `cave sandbox` uses for a given options blob. */
export function buildPolicyForRun(opts: SandboxRunOptions): SandboxPolicy {
	if (opts.policy) return opts.policy;
	const cwd = opts.workdir ?? process.cwd();
	const base = defaultPolicyForMode(opts.mode ?? "default", cwd);
	if (base.kind !== "workspace_write") return base;
	return {
		...base,
		extraWritableRoots: opts.extraWritableRoots ?? base.extraWritableRoots,
		allowedHosts: opts.allowedHosts ?? base.allowedHosts,
		allowAllNetwork: opts.allowAllNetwork ?? base.allowAllNetwork,
	};
}

/**
 * Wrap and run a shell command under cave's sandbox policy.
 *
 * Pure-build path (no spawn) is reachable via `dryRun: true` for tests.
 */
export function runSandboxCommand(
	command: string,
	opts: SandboxRunOptions & { dryRun?: boolean } = {},
): SandboxRunResult {
	const policy = buildPolicyForRun(opts);
	const sel = selectSandboxFromPolicy(process.platform, release(), policy);
	const wrapped = sel.sandbox.wrap(command);

	if (opts.dryRun) {
		return { exitCode: 0, wrappedCommand: wrapped, policy, warning: sel.warning };
	}

	const child = spawnSync("bash", ["-c", wrapped], {
		stdio: "inherit",
		env: process.env,
	});

	return {
		exitCode: child.status ?? (child.signal ? 128 : 1),
		wrappedCommand: wrapped,
		policy,
		warning: sel.warning,
		stderr: child.stderr?.toString(),
	};
}

// ── CLI subcommand handler: `cave sandbox -- <cmd...>` ────────────────────

const HELP_TEXT = `Usage:
  cave sandbox [--mode=MODE] [--allow-host=HOST]... [--allow-net] [--dry-run] -- <command...>
  cave debug sandbox            Show the SBPL/landlock profile that would apply.
  cave execpolicy check <cmd>   Show the reducer decision for a hypothetical exec.

Modes (default = workspace_write):
  default          workspace_write policy, prompt-on-first-use
  plan             read_only — refuse all writes/exec/network
  acceptEdits      workspace_write, auto-allow workspace edits
  auto             Haiku-class classifier picks (TODO: ws3-classifier)
  bypassPermissions  danger_full_access — never prompt, log everything

Flags:
  --allow-host=HOST   Add a host to the workspace_write allowlist (repeatable).
                      Wildcards: *.github.com.
  --allow-net         Disable per-host filtering (allow all egress).
  --extra-write=DIR   Allow writes outside cwd to DIR (repeatable).
  --dry-run           Print the wrapped command without executing.

EXPERIMENTAL: cave's sandbox is feature-flagged for the first 2 weeks. Set
CAVE_SANDBOX_EXPERIMENTAL=1 to opt in.`;

/** Parses argv after `cave sandbox`. Returns `null` for help/no-args. */
export interface SandboxCliArgs {
	help: boolean;
	mode: PermissionMode;
	allowedHosts: string[];
	allowAllNetwork: boolean;
	extraWritableRoots: string[];
	dryRun: boolean;
	command: string[];
}

export function parseSandboxCliArgs(argv: string[]): SandboxCliArgs {
	const args: SandboxCliArgs = {
		help: false,
		mode: "default",
		allowedHosts: [],
		allowAllNetwork: false,
		extraWritableRoots: [],
		dryRun: false,
		command: [],
	};
	let i = 0;
	while (i < argv.length) {
		const a = argv[i];
		if (a === "--") {
			args.command = argv.slice(i + 1);
			break;
		}
		if (a === "--help" || a === "-h") {
			args.help = true;
		} else if (a === "--dry-run") {
			args.dryRun = true;
		} else if (a === "--allow-net") {
			args.allowAllNetwork = true;
		} else if (a.startsWith("--mode=")) {
			args.mode = a.slice("--mode=".length) as PermissionMode;
		} else if (a.startsWith("--allow-host=")) {
			args.allowedHosts.push(a.slice("--allow-host=".length));
		} else if (a.startsWith("--extra-write=")) {
			args.extraWritableRoots.push(a.slice("--extra-write=".length));
		} else if (!a.startsWith("-")) {
			// Positional before `--` — treat the rest as the command.
			args.command = argv.slice(i);
			break;
		}
		i++;
	}
	return args;
}

/**
 * Top-level `cave sandbox`/`cave debug sandbox`/`cave execpolicy check` entry.
 *
 * Returns true if the args matched a sandbox subcommand and were handled
 * (so main.ts can short-circuit and skip the agent loop). Returns false if
 * the args weren't ours.
 */
export function handleSandboxCommand(argv: string[]): boolean {
	if (argv.length === 0) return false;

	// `cave debug sandbox`
	if (argv[0] === "debug" && argv[1] === "sandbox") {
		return handleDebugSandbox(argv.slice(2));
	}
	// `cave execpolicy check <cmd...>`
	if (argv[0] === "execpolicy" && argv[1] === "check") {
		return handleExecpolicyCheck(argv.slice(2));
	}
	// `cave sandbox ...`
	if (argv[0] !== "sandbox") return false;

	const args = parseSandboxCliArgs(argv.slice(1));
	if (args.help || args.command.length === 0) {
		process.stdout.write(HELP_TEXT + "\n");
		return true;
	}

	if (!isSandboxFlagEnabled()) {
		process.stderr.write(
			"cave sandbox is EXPERIMENTAL. Set CAVE_SANDBOX_EXPERIMENTAL=1 to opt in.\n" +
				"See WS3 in context/plans/cave-v2-best-in-class.md for status.\n",
		);
		process.exit(2);
	}

	const result = runSandboxCommand(args.command.join(" "), {
		mode: args.mode,
		allowedHosts: args.allowedHosts,
		allowAllNetwork: args.allowAllNetwork,
		extraWritableRoots: args.extraWritableRoots,
		dryRun: args.dryRun,
	});

	if (result.warning) process.stderr.write(`warning: ${result.warning}\n`);
	if (args.dryRun) {
		process.stdout.write(result.wrappedCommand + "\n");
	}
	process.exit(result.exitCode);
}

function handleDebugSandbox(argv: string[]): boolean {
	const args = parseSandboxCliArgs(argv);
	const policy = buildPolicyForRun({
		mode: args.mode,
		allowedHosts: args.allowedHosts,
		allowAllNetwork: args.allowAllNetwork,
		extraWritableRoots: args.extraWritableRoots,
	});
	const sel = selectSandboxFromPolicy(process.platform, release(), policy);
	process.stdout.write(`platform: ${process.platform}\n`);
	process.stdout.write(`policy: ${JSON.stringify(policy, null, 2)}\n`);
	if (sel.warning) process.stdout.write(`warning: ${sel.warning}\n`);
	process.stdout.write(`profile.kind: ${sel.sandbox.profile.kind}\n`);
	process.stdout.write(`wrap("<cmd>"):\n${sel.sandbox.wrap("<cmd>")}\n`);
	return true;
}

function handleExecpolicyCheck(argv: string[]): boolean {
	if (argv.length === 0) {
		process.stderr.write("Usage: cave execpolicy check <command...>\n");
		process.exit(2);
	}
	// Lazy import to avoid pulling permission-prompt into every CLI start.
	import("@cave/agent")
		.then((mod) => {
			const policy = defaultPolicyForMode("default", process.cwd());
			const decision = mod.reduce({
				policy,
				mode: "default",
				action: { tier: "exec", command: argv[0], argv },
				store: { alwaysAllow: [] },
			});
			process.stdout.write(`decision: ${JSON.stringify(decision, null, 2)}\n`);
			process.stdout.write(`allow-key: ${mod.normalizeCommandKey(argv)}\n`);
		})
		.catch((err) => {
			process.stderr.write(`error: ${err}\n`);
			process.exit(1);
		});
	return true;
}

/** Feature-flag check (env or `--sandbox=experimental` flag handled upstream). */
export function isSandboxFlagEnabled(): boolean {
	const env = process.env.CAVE_SANDBOX_EXPERIMENTAL;
	if (!env) return false;
	return env === "1" || env.toLowerCase() === "true" || env.toLowerCase() === "yes";
}
