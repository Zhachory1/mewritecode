/**
 * Plan persistence — saves the model's plan-mode output to
 * `~/.cave/plans/{slug}.md` so it survives session restart, fork, and resume.
 *
 * Mirrors claude-code utils/plans.ts (slug per session, settings override,
 * fork/resume recovery). Cave-specific differences:
 *   - Single canonical dir at `getAgentDir()/plans/`. No setting override yet.
 *   - The /act command rehydrates the plan into the next user message instead
 *     of opening a permission dialog (cave is autopilot — see
 *     feedback_no_permissions.md).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

const PLAN_FILENAME_RE = /[^a-z0-9-]+/g;

function plansDir(): string {
	const dir = join(getAgentDir(), "plans");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

/** Convert a free-form session id into a stable, filesystem-safe slug. */
export function getPlanSlug(sessionId: string): string {
	const cleaned = sessionId
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(PLAN_FILENAME_RE, "");
	const trimmed = cleaned.replace(/^-+|-+$/g, "");
	return trimmed || "plan";
}

/** Absolute path to the plan file for a given session. */
export function getPlanFilePath(sessionId: string): string {
	return join(plansDir(), `${getPlanSlug(sessionId)}.md`);
}

/** Persist the plan text. Creates the file (or overwrites). */
export function writePlan(sessionId: string, plan: string): string {
	const path = getPlanFilePath(sessionId);
	writeFileSync(path, plan, { encoding: "utf-8", mode: 0o600 });
	return path;
}

/** Read the saved plan. Returns empty string when no plan exists. */
export function readPlan(sessionId: string): string {
	const path = getPlanFilePath(sessionId);
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Heuristic: extract the model's plan from a free-form assistant message.
 * Looks for the literal `Plan:` heading — the same shape requested by the
 * PLAN_MODE_BANNER. Falls back to the full message when no header is found.
 */
export function extractPlanFromMessage(message: string): string {
	const m = /(^|\n)Plan:\s*\n([\s\S]+?)(?=\n#|\n##|$)/i.exec(message);
	if (m) return m[2].trim();
	return message.trim();
}
