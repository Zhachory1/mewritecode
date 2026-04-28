/**
 * WS3: Permission prompt — 4-verb interactive escape from the SandboxPolicy reducer.
 *
 * The agent runtime calls `decideAction()` for every tool action. If the
 * reducer returns `prompt`, the TUI renders this 4-verb chooser:
 *
 *   ▸ Allow once          — proceed for this action only       (default for `edit`/`exec`/`network`)
 *     Allow this session  — remember until cave exits          (held in memory)
 *     Allow always        — persist normalized key to .cave/permissions.json
 *     Deny                — refuse                             (default for sensitive `read` and out-of-workspace `edit`)
 *
 * The reducer's `defaultVerb` determines which row is highlighted by default.
 *
 * Allow-always is keyed by *normalized command shape*, not the raw string.
 * Once the user grants `git status -*`, every later `git status` invocation
 * skips the prompt entirely.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	actionToAllowKey,
	type Decision,
	type PermissionMode,
	type PermissionStore,
	type PromptVerb,
	type ProposedAction,
	reduce,
	type SandboxPolicy,
} from "@cave/agent";
import { CONFIG_DIR_NAME } from "../config.js";

// ── Permission store on disk (.cave/permissions.json) ─────────────────────

export function getPermissionsPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "permissions.json");
}

export function loadPermissionStore(cwd: string): PermissionStore {
	const path = getPermissionsPath(cwd);
	if (!existsSync(path)) return emptyStore();
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		const list = Array.isArray(raw?.alwaysAllow) ? raw.alwaysAllow.filter((x: unknown) => typeof x === "string") : [];
		return { alwaysAllow: list };
	} catch {
		return emptyStore();
	}
}

function emptyStore(): PermissionStore {
	// Critical: callers like appendAlwaysAllow mutate `alwaysAllow.push(...)`,
	// so we must hand back a fresh array each time — never share a reference
	// with EMPTY_PERMISSION_STORE.
	return { alwaysAllow: [] };
}

export function savePermissionStore(cwd: string, store: PermissionStore): void {
	const path = getPermissionsPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ alwaysAllow: store.alwaysAllow }, null, 2) + "\n", "utf-8");
}

export function appendAlwaysAllow(cwd: string, key: string): PermissionStore {
	const store = loadPermissionStore(cwd);
	if (!store.alwaysAllow.includes(key)) {
		store.alwaysAllow.push(key);
		savePermissionStore(cwd, store);
	}
	return store;
}

// ── Session-scope grants (in-memory, never written to disk) ───────────────

export class SessionAllowList {
	private readonly keys = new Set<string>();
	add(key: string): void {
		this.keys.add(key);
	}
	has(key: string): boolean {
		return this.keys.has(key);
	}
	values(): string[] {
		return [...this.keys];
	}
	clear(): void {
		this.keys.clear();
	}
}

// ── Permission session orchestration ──────────────────────────────────────
//
// `PermissionSession.decide()` is the entry point tools call. It composes:
//   1. session-scope allow list (memory)
//   2. persisted allow-always store (disk)
//   3. SandboxPolicy reducer
//
// If the reducer returns `prompt`, callers must hand the user the 4-verb
// chooser through the injected `prompt` callback. The chooser default is
// always the reducer's `defaultVerb` field — the UI must highlight it.

export interface PromptUI {
	/** Render the 4-verb chooser. Resolves with the user's pick. */
	chooseVerb(opts: PromptOptions): Promise<PromptVerb>;
}

export interface PromptOptions {
	summary: string;
	defaultVerb: PromptVerb;
	allowAlwaysKey: string;
}

export interface PermissionSessionOptions {
	cwd: string;
	policy: SandboxPolicy;
	mode: PermissionMode;
	ui: PromptUI;
	/** Override store (for tests). Defaults to loading from .cave/. */
	store?: PermissionStore;
}

export interface DecideResult {
	allowed: boolean;
	verb?: PromptVerb;
	reason?: string;
}

export class PermissionSession {
	private store: PermissionStore;
	private readonly session: SessionAllowList;
	constructor(private readonly opts: PermissionSessionOptions) {
		this.store = opts.store ?? loadPermissionStore(opts.cwd);
		this.session = new SessionAllowList();
	}

	getStore(): PermissionStore {
		return this.store;
	}

	getSessionAllowList(): SessionAllowList {
		return this.session;
	}

	/** Decide a single proposed action. Prompts the user when needed. */
	async decide(action: ProposedAction): Promise<DecideResult> {
		const key = actionToAllowKey(action);

		// Session grants short-circuit before we hit the reducer.
		if (this.session.has(key)) {
			return { allowed: true, verb: "allow_session" };
		}

		const decision: Decision = reduce({
			policy: this.opts.policy,
			mode: this.opts.mode,
			action,
			store: this.store,
		});

		if (decision.kind === "allow") return { allowed: true };
		if (decision.kind === "deny") return { allowed: false, reason: decision.reason };

		// kind === "prompt"
		const verb = await this.opts.ui.chooseVerb({
			summary: decision.summary,
			defaultVerb: decision.defaultVerb,
			allowAlwaysKey: decision.allowAlwaysKey,
		});

		switch (verb) {
			case "allow_once":
				return { allowed: true, verb };
			case "allow_session":
				this.session.add(key);
				return { allowed: true, verb };
			case "allow_always":
				this.store = appendAlwaysAllow(this.opts.cwd, key);
				return { allowed: true, verb };
			case "deny":
				return { allowed: false, verb, reason: "denied by user" };
		}
	}
}

// ── Mode cycling (Shift+Tab) ──────────────────────────────────────────────

export const PERMISSION_MODES: readonly PermissionMode[] = [
	"default",
	"plan",
	"acceptEdits",
	"auto",
	"bypassPermissions",
] as const;

export function cycleMode(current: PermissionMode): PermissionMode {
	const idx = PERMISSION_MODES.indexOf(current);
	return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length];
}

export function describeMode(mode: PermissionMode): string {
	switch (mode) {
		case "default":
			return "default (prompt on first non-trivial action)";
		case "plan":
			return "plan (read-only, refuse all writes/exec/network)";
		case "acceptEdits":
			return "acceptEdits (auto-allow workspace edits, prompt others)";
		case "auto":
			return "auto (Haiku-class classifier picks; prompt on uncertain)";
		case "bypassPermissions":
			return "bypassPermissions (never prompt — log everything)";
	}
}
