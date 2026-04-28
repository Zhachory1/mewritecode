// WS3: SandboxPolicy IR + reducer.
//
// Public surface for cave's sandboxing layer. Tools route every action
// (read/edit/exec/network) through the reducer below to obtain a Decision
// (`allow` | `prompt` | `deny`) along with the persisted "allow-always" key
// shape and the reversibility tier that drives the prompt's default verb.
//
// IR design — three tagged-union policies:
//   - `read_only`           : reads anywhere on disk, no writes, no exec, no net
//   - `workspace_write`     : writes confined to cwd subtree (+ explicit allow),
//                             reads anywhere, exec inside sandbox, net via proxy
//   - `danger_full_access`  : everything goes (developer break-glass)
//
// Permission modes (cycled by Shift+Tab in the TUI):
//   - `default`             : prompt on first non-trivial action
//   - `plan`                : refuse all writes/exec/network (think-only)
//   - `acceptEdits`         : auto-approve edits inside workspace, prompt others
//   - `auto`                : Haiku-class classifier picks; prompt on uncertain
//   - `bypassPermissions`   : never prompt (trust mode — log everything)
//
// The reducer is pure: same inputs → same Decision. Allow-always lookups are
// keyed by *normalized command shapes* — `git status -*` matches all `git
// status` invocations regardless of args, the user only confirms once.
//
// Patterns borrowed from pi-sandbox (carderne) for prompt verbs and config
// schema. Implementation built from scratch — pi-sandbox is an extension that
// hooks pi-coding-agent's runtime; cave needs an in-tree IR + reducer instead.

export type PermissionMode = "default" | "plan" | "acceptEdits" | "auto" | "bypassPermissions";

/** Reversibility tier of an action — drives the default-highlighted verb. */
export type ReversibilityTier = "read" | "edit" | "exec" | "network";

/** Tagged union — the SandboxPolicy IR. */
export type SandboxPolicy =
	| {
			kind: "read_only";
			workdir: string;
	  }
	| {
			kind: "workspace_write";
			workdir: string;
			/** Extra subtrees outside cwd that may be written to. */
			extraWritableRoots: string[];
			/** Hosts the local CONNECT proxy will allow (empty = no network). */
			allowedHosts: string[];
			/** Override: allow ALL network traffic (no proxy filter). */
			allowAllNetwork: boolean;
	  }
	| {
			kind: "danger_full_access";
			workdir: string;
	  };

/** Build a default policy for a given mode + workdir. */
export function defaultPolicyForMode(mode: PermissionMode, workdir: string): SandboxPolicy {
	switch (mode) {
		case "plan":
			return { kind: "read_only", workdir };
		case "bypassPermissions":
			return { kind: "danger_full_access", workdir };
		default:
			return {
				kind: "workspace_write",
				workdir,
				extraWritableRoots: [],
				allowedHosts: [],
				allowAllNetwork: false,
			};
	}
}

/** Action proposed by a tool — what the reducer decides on. */
export type ProposedAction =
	| { tier: "read"; path: string }
	| { tier: "edit"; path: string }
	| { tier: "exec"; command: string; argv: string[] }
	| { tier: "network"; host: string; port?: number };

export type Decision =
	| { kind: "allow" }
	| {
			kind: "prompt";
			/** Persisted lookup key (normalized command shape, abs path, etc.). */
			allowAlwaysKey: string;
			/** Default-highlighted verb based on reversibility tier. */
			defaultVerb: PromptVerb;
			/** Human-readable summary for the prompt UI. */
			summary: string;
	  }
	| { kind: "deny"; reason: string };

/** The 4 verbs cave's permission prompt offers. */
export type PromptVerb = "allow_once" | "allow_session" | "allow_always" | "deny";

/** Persisted "allow-always" rules. Lives at `.cave/permissions.json`. */
export interface PermissionStore {
	/** Keys produced by `actionToAllowKey`. Match by exact equality. */
	alwaysAllow: string[];
}

export const EMPTY_PERMISSION_STORE: PermissionStore = { alwaysAllow: [] };

// ── Path helpers ──────────────────────────────────────────────────────────

function normalizePath(p: string): string {
	// Collapse trailing slash and `./` segments. Don't resolve `..` here —
	// callers that need full resolution should `path.resolve()` first.
	let out = p.replace(/\\/g, "/");
	while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
	return out;
}

function isUnderRoot(absPath: string, root: string): boolean {
	const a = normalizePath(absPath);
	const r = normalizePath(root);
	if (a === r) return true;
	return a.startsWith(r + "/");
}

// ── Command normalization for allow-always keys ────────────────────────────
//
// Goal: `git status` and `git status -s` and `git status --porcelain` all
// share one allow-always key — the user shouldn't be re-prompted for variants
// of the same command shape. Normalization keeps the head verb + first
// non-flag subcommand, then collapses the rest into `*`.

const COMMAND_HEADS_WITH_SUBCOMMANDS = new Set([
	"git",
	"npm",
	"pnpm",
	"yarn",
	"cargo",
	"go",
	"docker",
	"kubectl",
	"gh",
	"aws",
	"gcloud",
	"brew",
]);

export function normalizeCommandKey(argv: string[]): string {
	if (argv.length === 0) return "exec:";
	const head = argv[0].split("/").pop() ?? argv[0]; // strip path on bin
	const parts = [head];
	if (COMMAND_HEADS_WITH_SUBCOMMANDS.has(head) && argv.length > 1) {
		// Skip leading flags before the subcommand: `git --no-pager status` → `git status -*`.
		let i = 1;
		while (i < argv.length && argv[i].startsWith("-")) i++;
		if (i < argv.length) parts.push(argv[i]);
	}
	parts.push("-*");
	return `exec:${parts.join(" ")}`;
}

export function actionToAllowKey(action: ProposedAction): string {
	switch (action.tier) {
		case "read":
			return `read:${normalizePath(action.path)}`;
		case "edit":
			return `edit:${normalizePath(action.path)}`;
		case "exec":
			return normalizeCommandKey(action.argv);
		case "network": {
			const host = action.host.toLowerCase();
			return action.port ? `net:${host}:${action.port}` : `net:${host}`;
		}
	}
}

// ── Reducer ───────────────────────────────────────────────────────────────

export interface ReducerInput {
	policy: SandboxPolicy;
	mode: PermissionMode;
	action: ProposedAction;
	store: PermissionStore;
}

/** Pure reducer — single source of truth for sandbox decisions. */
export function reduce(input: ReducerInput): Decision {
	const { policy, mode, action, store } = input;

	// bypassPermissions short-circuits everything (logged, never prompted).
	if (mode === "bypassPermissions") return { kind: "allow" };

	// Allow-always is the highest-priority user-grant — checked before policy.
	const key = actionToAllowKey(action);
	if (store.alwaysAllow.includes(key)) return { kind: "allow" };

	// Plan mode is intentionally restrictive — read-only regardless of policy.
	if (mode === "plan") {
		if (action.tier === "read") {
			return decideRead(policy, action.path, key);
		}
		return { kind: "deny", reason: "plan mode: writes/exec/network disabled" };
	}

	if (policy.kind === "danger_full_access") return { kind: "allow" };

	if (action.tier === "read") {
		return decideRead(policy, action.path, key);
	}

	if (policy.kind === "read_only") {
		return {
			kind: "deny",
			reason: `read_only policy denies ${action.tier}`,
		};
	}

	// policy.kind === "workspace_write" from here.
	if (action.tier === "edit") {
		const inWorkspace = isUnderRoot(action.path, policy.workdir);
		const inExtraRoot = policy.extraWritableRoots.some((r) => isUnderRoot(action.path, r));
		if (inWorkspace || inExtraRoot) {
			if (mode === "acceptEdits") return { kind: "allow" };
			return {
				kind: "prompt",
				allowAlwaysKey: key,
				defaultVerb: "allow_once",
				summary: `Edit ${action.path}`,
			};
		}
		return {
			kind: "prompt",
			allowAlwaysKey: key,
			// Edit outside workspace is destructive — default to deny.
			defaultVerb: "deny",
			summary: `Edit ${action.path} (outside workspace)`,
		};
	}

	if (action.tier === "exec") {
		// `auto` mode would consult the Haiku classifier here; for now we prompt.
		// TODO(ws3-classifier): wire Haiku-class classifier with cached system
		// prompt for `auto` mode triage.
		return {
			kind: "prompt",
			allowAlwaysKey: key,
			defaultVerb: "allow_once",
			summary: `Run ${action.argv.join(" ")}`,
		};
	}

	// action.tier === "network".
	if (policy.allowAllNetwork) return { kind: "allow" };
	const host = action.host.toLowerCase();
	if (policy.allowedHosts.some((h) => hostMatches(host, h.toLowerCase()))) {
		return { kind: "allow" };
	}
	return {
		kind: "prompt",
		allowAlwaysKey: key,
		// Network is harder to reverse than reads but easier than writes — default once.
		defaultVerb: "allow_once",
		summary: `Connect to ${action.host}${action.port ? `:${action.port}` : ""}`,
	};
}

function decideRead(policy: SandboxPolicy, absPath: string, key: string): Decision {
	// Sensitive paths are always prompted (default deny). The same set the
	// Seatbelt profile hard-blocks at OS level — we surface them in the IR
	// so the prompt fires before the syscall, not after.
	for (const sensitive of SENSITIVE_PATHS) {
		if (absPath.includes(sensitive)) {
			return {
				kind: "prompt",
				allowAlwaysKey: key,
				defaultVerb: "deny",
				summary: `Read sensitive path ${absPath}`,
			};
		}
	}
	if (policy.kind === "read_only" || policy.kind === "workspace_write" || policy.kind === "danger_full_access") {
		return { kind: "allow" };
	}
	return { kind: "allow" };
}

function hostMatches(host: string, pattern: string): boolean {
	if (pattern.startsWith("*.")) {
		const base = pattern.slice(2);
		return host === base || host.endsWith("." + base);
	}
	return host === pattern;
}

const SENSITIVE_PATHS = [".ssh/", ".aws/", ".gnupg/", ".netrc", ".config/gcloud", ".env", ".env.local"];
