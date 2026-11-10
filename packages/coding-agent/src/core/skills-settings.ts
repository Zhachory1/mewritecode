/**
 * Skill settings for RPC clients: list local skills and enable or disable them for
 * new sessions using the existing `-<path>` force-exclude entries in the `skills`
 * setting of the skill's own scope. Package-provided skills are listed read-only.
 */

import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { DefaultPackageManager } from "./package-manager.js";
import type { SettingsManager } from "./settings-manager.js";

export interface SkillSummary {
	id: string;
	name: string;
	source: string;
	scope: "user" | "project";
	enabled: boolean;
	editable: boolean;
	status: "enabled" | "disabled";
	/** Skill with the same name that loads instead if this one is disabled. */
	replacement?: SkillRef;
	/** Enabled skill with the same name that this one would replace if enabled. */
	displaces?: SkillRef;
}

type SkillRef = Pick<SkillSummary, "name" | "source" | "scope">;

export interface SkillInventory {
	skills: SkillSummary[];
	revision: string;
}

// Settings entries name a skill by its directory (SKILL.md) or its file path.
const skillEntryPath = (path: string) => (basename(path) === "SKILL.md" ? dirname(path) : path);

function revisionOf(settings: SettingsManager): string {
	const skills = { user: settings.getGlobalSettings().skills, project: settings.getProjectSettings().skills };
	return createHash("sha256").update(JSON.stringify(skills)).digest("hex");
}

export async function getSkillInventory(
	settings: SettingsManager,
	cwd: string,
	agentDir: string,
): Promise<SkillInventory> {
	await settings.reload();
	const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }).resolve();
	const skills: SkillSummary[] = [];
	for (const resource of resolved.skills) {
		const scope = resource.metadata.scope;
		if (scope !== "user" && scope !== "project") continue;
		const path = skillEntryPath(resource.path);
		const editable = resource.metadata.origin === "top-level";
		skills.push({
			id: createHash("sha256").update(`${scope}\0${path}`).digest("hex").slice(0, 32),
			name: basename(path).replace(/\.md$/, ""),
			source: editable ? resource.metadata.source : "package",
			scope,
			enabled: resource.enabled,
			editable,
			status: resource.enabled ? "enabled" : "disabled",
		});
	}
	// Resolution order is load order; the first enabled skill with a name wins.
	const ref = ({ name, source, scope }: SkillSummary): SkillRef => ({ name, source, scope });
	for (const skill of skills) {
		const sameName = skills.filter((other) => other !== skill && other.name === skill.name && other.enabled);
		if (skill.enabled) {
			const index = skills.indexOf(skill);
			const next = sameName.find((other) => skills.indexOf(other) > index);
			if (next && !sameName.some((other) => skills.indexOf(other) < index)) skill.replacement = ref(next);
		} else if (sameName.length > 0) {
			skill.displaces = ref(sameName[0]);
		}
	}
	return { skills, revision: revisionOf(settings) };
}

export async function setSkillEnabled(
	input: { skillId: string; revision: string; scope: "user" | "project"; enabled: boolean },
	settings: SettingsManager,
	cwd: string,
	agentDir: string,
): Promise<{ appliesTo: "next-session" }> {
	await settings.reload();
	if (input.revision !== revisionOf(settings)) throw new Error("Skill settings changed; refresh and retry");
	if (typeof input.enabled !== "boolean") throw new Error("enabled must be a boolean");
	const resolved = await new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }).resolve();
	const resource = resolved.skills.find(
		(r) =>
			r.metadata.origin === "top-level" &&
			r.metadata.scope === input.scope &&
			createHash("sha256")
				.update(`${input.scope}\0${skillEntryPath(r.path)}`)
				.digest("hex")
				.slice(0, 32) === input.skillId,
	);
	if (!resource) throw new Error("Skill not found; refresh and retry");
	if (resource.enabled === input.enabled) return { appliesTo: "next-session" };

	// Force-exclude entries are absolute paths, which match regardless of the scope's base dir.
	const exclude = `-${skillEntryPath(resource.path)}`;
	const current =
		(input.scope === "user" ? settings.getGlobalSettings().skills : settings.getProjectSettings().skills) ?? [];
	const next = input.enabled ? current.filter((entry) => entry !== exclude) : [...current, exclude];
	if (input.enabled && next.length === current.length) {
		throw new Error("Skill is disabled by a pattern in settings; edit settings to enable it");
	}
	if (input.scope === "user") settings.setSkillPaths(next);
	else settings.setProjectSkillPaths(next);
	await settings.flush();
	const failures = settings.drainErrors();
	if (failures.length > 0) throw new Error("Could not write skill settings; check write permission");
	return { appliesTo: "next-session" };
}
