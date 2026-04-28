/**
 * Hooks registry. Loads hook configurations from settings.json
 * (Claude Code-compatible schema) and resolves which hooks fire
 * for a given (event, matcher-string) pair.
 *
 * Compatibility: a user pasting their `~/.claude/settings.json` `hooks`
 * key into `~/.cave/settings.json` (or `.cave/settings.json`) must
 * work unchanged for the 12 cave-supported events.
 */

import type { CaveHookEvent, HookConfig, HookMatcherGroup, HooksConfig } from "./events.js";
import { CAVE_HOOK_EVENTS, isCaveHookEvent } from "./events.js";

export interface MatchedHook {
	event: CaveHookEvent | string;
	/** The matcher string from the group, if any. */
	matcher: string | undefined;
	hook: HookConfig;
	/** Source scope this hook was loaded from. */
	scope: "global" | "project" | "policy" | "runtime";
}

export interface RegistryLoadIssue {
	scope: string;
	event?: string;
	message: string;
}

export interface HooksRegistryOptions {
	/**
	 * If true, all hooks are disabled regardless of configuration.
	 * Mirrors Claude Code's `disableAllHooks` flag.
	 */
	disableAllHooks?: boolean;
}

/**
 * Holds parsed `hooks` blocks from one or more scopes.
 *
 * Lookup precedence (highest to lowest, matching CC):
 *   policy > project > global > runtime
 *
 * In practice cave currently exposes global + project; policy/runtime are
 * reserved for WS3/WS5 to plug into without churning this API.
 */
export class HooksRegistry {
	private layers = new Map<MatchedHook["scope"], HooksConfig>();
	private issues: RegistryLoadIssue[] = [];
	private options: HooksRegistryOptions;
	private firedOnce = new Set<HookConfig>();

	constructor(options: HooksRegistryOptions = {}) {
		this.options = options;
	}

	setLayer(scope: MatchedHook["scope"], hooks: HooksConfig | undefined | null): void {
		if (!hooks || typeof hooks !== "object") {
			this.layers.delete(scope);
			return;
		}
		const validated = this.validate(scope, hooks);
		this.layers.set(scope, validated);
	}

	clearLayer(scope: MatchedHook["scope"]): void {
		this.layers.delete(scope);
	}

	/** Reset the once-per-session firing tracker. */
	resetSession(): void {
		this.firedOnce.clear();
	}

	setDisabled(disabled: boolean): void {
		this.options.disableAllHooks = disabled;
	}

	/** Return validation issues encountered the last time setLayer ran. */
	getIssues(): readonly RegistryLoadIssue[] {
		return this.issues;
	}

	/** Return all configured (event -> matcher count) pairs across scopes. */
	summarize(): Array<{ event: string; matcher: string | undefined; scope: string; type: string }> {
		const out: Array<{ event: string; matcher: string | undefined; scope: string; type: string }> = [];
		for (const [scope, cfg] of this.layers.entries()) {
			for (const [event, groups] of Object.entries(cfg)) {
				for (const group of groups ?? []) {
					for (const hook of group.hooks ?? []) {
						out.push({
							event,
							matcher: group.matcher,
							scope,
							type: hook.type ?? "command",
						});
					}
				}
			}
		}
		return out;
	}

	/**
	 * Resolve every hook that fires for the given event.
	 *
	 * `matcherInput` is the runtime string that the matcher pattern is
	 * tested against (typically the tool name for PreToolUse / PostToolUse,
	 * or the SessionStart "source" string, etc.). Pass undefined for events
	 * that have no matcher field (e.g. UserPromptSubmit, Stop).
	 */
	resolve(event: CaveHookEvent | string, matcherInput: string | undefined): MatchedHook[] {
		if (this.options.disableAllHooks) {
			return [];
		}

		const matched: MatchedHook[] = [];
		// Iterate in lowest -> highest scope order so that the resulting
		// list still preserves source order, but callers can inspect scope.
		const scopeOrder: MatchedHook["scope"][] = ["runtime", "global", "project", "policy"];
		for (const scope of scopeOrder) {
			const cfg = this.layers.get(scope);
			if (!cfg) continue;
			const groups = cfg[event];
			if (!groups) continue;
			for (const group of groups) {
				if (!this.matcherMatches(group.matcher, matcherInput)) continue;
				for (const hook of group.hooks ?? []) {
					if (hook.once && this.firedOnce.has(hook)) {
						continue;
					}
					matched.push({ event, matcher: group.matcher, hook, scope });
				}
			}
		}
		return matched;
	}

	/** Mark a hook as fired (for `once: true` enforcement). */
	markFired(hook: HookConfig): void {
		if (hook.once) {
			this.firedOnce.add(hook);
		}
	}

	/** True when the matcher pattern matches the runtime input. */
	private matcherMatches(matcher: string | undefined, input: string | undefined): boolean {
		if (matcher === undefined || matcher === "" || matcher === "*") {
			return true;
		}
		if (input === undefined) {
			// No input to test against; treat the matcher as informational.
			return true;
		}
		try {
			// Anchor regex at both ends so `Bash` doesn't match `BashTool`.
			const rx = new RegExp(`^(?:${matcher})$`);
			return rx.test(input);
		} catch {
			// If the pattern isn't a valid regex, fall back to literal equality
			// (matches Claude Code behavior for FileChanged literal filenames).
			return matcher === input;
		}
	}

	/** Validate a hooks config block; collect parse issues. */
	private validate(scope: string, hooks: HooksConfig): HooksConfig {
		this.issues = this.issues.filter((i) => i.scope !== scope);
		const out: HooksConfig = {};
		for (const [event, groups] of Object.entries(hooks)) {
			if (!Array.isArray(groups)) {
				this.issues.push({
					scope,
					event,
					message: `'${event}' must be an array of matcher groups, got ${typeof groups}`,
				});
				continue;
			}
			if (!isCaveHookEvent(event)) {
				// Forward-compat: accept the event silently so a Claude Code
				// settings.json paste doesn't error, but record an info issue.
				this.issues.push({
					scope,
					event,
					message: `event '${event}' is not currently fired by cave (Claude Code-only). Configuration kept for forward-compat.`,
				});
			}
			out[event] = (groups as unknown[])
				.map((g, i) => this.validateGroup(scope, event, i, g))
				.filter((g): g is HookMatcherGroup => g !== null);
		}
		return out;
	}

	private validateGroup(scope: string, event: string, index: number, group: unknown): HookMatcherGroup | null {
		if (!group || typeof group !== "object") {
			this.issues.push({
				scope,
				event,
				message: `${event}[${index}] must be an object`,
			});
			return null;
		}
		const g = group as Record<string, unknown>;
		const matcher = typeof g.matcher === "string" ? g.matcher : undefined;
		const rawHooks = g.hooks;
		if (!Array.isArray(rawHooks)) {
			this.issues.push({
				scope,
				event,
				message: `${event}[${index}].hooks must be an array`,
			});
			return null;
		}
		const hooks: HookConfig[] = [];
		for (let i = 0; i < rawHooks.length; i++) {
			const h = rawHooks[i];
			if (!h || typeof h !== "object") {
				this.issues.push({
					scope,
					event,
					message: `${event}[${index}].hooks[${i}] must be an object`,
				});
				continue;
			}
			const hook = h as HookConfig;
			const type = hook.type ?? "command";
			if (type === "command" && typeof hook.command !== "string") {
				this.issues.push({
					scope,
					event,
					message: `${event}[${index}].hooks[${i}] type='command' requires 'command' string`,
				});
				continue;
			}
			if (type === "http" && typeof hook.url !== "string") {
				this.issues.push({
					scope,
					event,
					message: `${event}[${index}].hooks[${i}] type='http' requires 'url' string (deferred — recorded but inactive in v1)`,
				});
				continue;
			}
			hooks.push(hook);
		}
		return { matcher, hooks };
	}
}

/** Return all events known to cave (helper for `cave hooks list`). */
export function listCaveHookEvents(): readonly string[] {
	return CAVE_HOOK_EVENTS;
}
