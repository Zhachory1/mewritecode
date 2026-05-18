/**
 * WS8: `/architect` chat mode — architect/editor split routing.
 *
 * In architect mode the strong (plan-tier) model gets long-form thinking
 * and emits a high-level plan. The editor (cheap-tier) model receives the
 * plan + file context and translates it to concrete file edits using one
 * of the `editor-*` edit formats.
 *
 * The mode is plan-only at the architect layer: the architect is
 * specifically told NOT to emit edit blocks. That decoupling is what
 * gives Aider its +5–10pp pass@1 on the architect/editor pairing.
 *
 * Routing is wired through `@caveman-code/agent`'s ModelRouter — the architect
 * mode swaps in a profile that:
 *   - sets `plan` role to a high-end model (long-form thinking)
 *   - sets `edit` role to the cheap tier (cheapTier mapping)
 *   - tags retention=long on plan to amortize the planning prompt cache
 */

import {
	DEFAULT_PROFILE,
	type ModelRouter,
	type RouteContext,
	type RoutingDecision,
	type RoutingProfile,
} from "@caveman-code/agent";
import type { EditFormatName } from "../edit-formats/types.js";

export interface ArchitectModeConfig {
	/** Architect (planning) model id. Defaults to plan-tier of base profile. */
	architectModel?: string;
	/** Editor (translation) model id. Defaults to cheap-tier edit. */
	editorModel?: string;
	/** Editor edit format. Defaults to `editor-diff`. */
	editorFormat?: EditFormatName;
	/** Underlying profile to derive from. Defaults to DEFAULT_PROFILE. */
	baseProfile?: RoutingProfile;
}

export interface ArchitectModeState {
	enabled: boolean;
	config: Required<Pick<ArchitectModeConfig, "editorFormat">> & ArchitectModeConfig;
}

/** System prompt fragment given to the architect model. */
export const ARCHITECT_SYSTEM_PROMPT = `You are operating as the ARCHITECT in an architect/editor pair.

Your job is to PLAN the change — not to write file edits. Use the repo map
and any pinned files to think through the problem in depth, then describe
the change as a numbered list of concrete operations. You may include
short code snippets to show intent, but DO NOT emit SEARCH/REPLACE blocks
or full files. The editor model will translate your plan into edits.

Format your plan as:
  1. <operation> — <file> — <one-line rationale>
  2. <operation> — <file> — <one-line rationale>
  ...
followed by any clarifying notes the editor will need.`;

/** System prompt fragment given to the editor model. */
export const EDITOR_SYSTEM_PROMPT_PREFIX = `You are operating as the EDITOR in an architect/editor pair.

You will receive (a) the architect's plan and (b) the relevant files. Your
sole job is to translate the plan into concrete file edits in the format
described below. Do not editorialize — execute the plan.`;

/**
 * Build the routing profile that architect mode installs.
 *
 * The plan role gets `architectModel` with long retention so the planning
 * prompt cache amortizes across follow-up turns. The edit role gets the
 * cheap-tier editor.
 */
export function buildArchitectProfile(config: ArchitectModeConfig): RoutingProfile {
	const base = config.baseProfile ?? DEFAULT_PROFILE;
	const architect = config.architectModel ?? base.roles.plan.model;
	const editor = config.editorModel ?? base.cheapTier?.edit ?? base.roles.edit.model;

	return {
		name: "architect",
		roles: {
			...base.roles,
			plan: { model: architect, retention: "long" },
			edit: { model: editor, retention: "short" },
		},
		cheapTier: base.cheapTier,
	};
}

/**
 * Wrap a base ModelRouter so plan-role calls always go to the architect
 * model, and edit-role calls go to the editor model. Cost-aware downgrade
 * still applies on the edit role via the underlying profile's cheapTier.
 */
export class ArchitectModeRouter implements ModelRouter {
	readonly profile: RoutingProfile;

	constructor(config: ArchitectModeConfig = {}) {
		this.profile = buildArchitectProfile(config);
	}

	route(ctx: RouteContext): RoutingDecision {
		const tier = this.profile.roles[ctx.role];
		if (!tier) {
			throw new Error(`architect router: profile has no role ${ctx.role}`);
		}
		// Downgrade rule mirrors DefaultModelRouter — keeps cost-cap intact.
		if (
			ctx.role !== "plan" &&
			ctx.sessionCapDollars &&
			ctx.sessionCostDollars &&
			ctx.sessionCostDollars >= ctx.sessionCapDollars * 0.9
		) {
			const cheap = this.profile.cheapTier?.[ctx.role];
			if (cheap) {
				return { model: cheap, retention: tier.retention, profile: "architect:downgrade" };
			}
		}
		return { model: tier.model, retention: tier.retention, profile: "architect" };
	}
}

/** Default architect-mode state (disabled until /architect toggles it on). */
export function defaultArchitectState(): ArchitectModeState {
	return {
		enabled: false,
		config: { editorFormat: "editor-diff" },
	};
}

export interface ToggleResult {
	state: ArchitectModeState;
	message: string;
}

/** Toggle architect mode on/off. Pure — caller persists the result. */
export function toggleArchitectMode(
	current: ArchitectModeState,
	cmd: "on" | "off" | "toggle" | "status",
	cfg?: Partial<ArchitectModeConfig>,
): ToggleResult {
	if (cmd === "status") {
		return {
			state: current,
			message: current.enabled
				? `architect mode: ON  (architect=${current.config.architectModel ?? "default plan model"}, editor=${current.config.editorModel ?? "default edit model"}, format=${current.config.editorFormat})`
				: "architect mode: OFF",
		};
	}
	const enable = cmd === "on" || (cmd === "toggle" && !current.enabled);
	const next: ArchitectModeState = {
		enabled: enable,
		config: {
			...current.config,
			...cfg,
			editorFormat: cfg?.editorFormat ?? current.config.editorFormat ?? "editor-diff",
		},
	};
	return {
		state: next,
		message: enable ? `architect mode: ON  (editor format = ${next.config.editorFormat})` : "architect mode: OFF",
	};
}
