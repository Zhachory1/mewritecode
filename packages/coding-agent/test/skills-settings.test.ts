import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import { DefaultResourceLoader } from "../src/core/resource-loader.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { getSkillInventory, setSkillEnabled } from "../src/core/skills-settings.js";

function writeSkill(dir: string, name: string) {
	mkdirSync(join(dir, name), { recursive: true });
	writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`);
}

describe("skill settings", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function setup() {
		const root = mkdtempSync(join(tmpdir(), "mewrite-skills-settings-"));
		dirs.push(root);
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		writeSkill(join(cwd, CONFIG_DIR_NAME, "skills"), "proj-skill");
		writeSkill(join(agentDir, "skills"), "user-skill");
		const settings = SettingsManager.create(cwd, agentDir);
		return { cwd, agentDir, settings };
	}

	async function loadedSkillNames(cwd: string, agentDir: string) {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.create(cwd, agentDir),
		});
		await loader.reload();
		return loader.getSkills().skills.map((skill) => skill.name);
	}

	it("lists local skills by scope and toggles them for new sessions", async () => {
		const { cwd, agentDir, settings } = setup();
		const inventory = await getSkillInventory(settings, cwd, agentDir);
		const project = inventory.skills.find((s) => s.name === "proj-skill");
		const user = inventory.skills.find((s) => s.name === "user-skill");
		expect(project).toMatchObject({ scope: "project", enabled: true, editable: true });
		expect(user).toMatchObject({ scope: "user", enabled: true, editable: true });
		expect(await loadedSkillNames(cwd, agentDir)).toEqual(expect.arrayContaining(["proj-skill", "user-skill"]));

		await setSkillEnabled(
			{ skillId: project!.id, revision: inventory.revision, scope: "project", enabled: false },
			settings,
			cwd,
			agentDir,
		);
		const afterDisable = await getSkillInventory(settings, cwd, agentDir);
		expect(afterDisable.skills.find((s) => s.name === "proj-skill")?.enabled).toBe(false);
		expect(settings.getGlobalSettings().skills ?? []).toEqual([]);
		expect(await loadedSkillNames(cwd, agentDir)).not.toContain("proj-skill");

		await setSkillEnabled(
			{ skillId: project!.id, revision: afterDisable.revision, scope: "project", enabled: true },
			settings,
			cwd,
			agentDir,
		);
		expect(
			(await getSkillInventory(settings, cwd, agentDir)).skills.find((s) => s.name === "proj-skill")?.enabled,
		).toBe(true);
		expect(settings.getProjectSettings().skills).toEqual([]);
	});

	it("reports which same-named skill takes over and sees edits from other processes", async () => {
		const { cwd, agentDir, settings } = setup();
		writeSkill(join(agentDir, "skills"), "proj-skill");
		const inventory = await getSkillInventory(settings, cwd, agentDir);
		const [winner, shadowed] = inventory.skills.filter((s) => s.name === "proj-skill");
		expect(winner).toMatchObject({ scope: "project", replacement: { name: "proj-skill", scope: "user" } });
		expect(shadowed.replacement).toBeUndefined();

		const other = SettingsManager.create(cwd, agentDir);
		other.setSkillPaths(["-/elsewhere"]);
		await other.flush();
		await expect(
			setSkillEnabled(
				{ skillId: winner.id, revision: inventory.revision, scope: "project", enabled: false },
				settings,
				cwd,
				agentDir,
			),
		).rejects.toThrow(/refresh and retry/);

		const fresh = await getSkillInventory(settings, cwd, agentDir);
		await setSkillEnabled(
			{ skillId: winner.id, revision: fresh.revision, scope: "project", enabled: false },
			settings,
			cwd,
			agentDir,
		);
		const after = await getSkillInventory(settings, cwd, agentDir);
		expect(after.skills.find((s) => s.scope === "project" && s.name === "proj-skill")).toMatchObject({
			enabled: false,
			displaces: { scope: "user" },
		});
		expect(SettingsManager.create(cwd, agentDir).getGlobalSettings().skills).toEqual(["-/elsewhere"]);
	});

	it("rejects stale revisions, wrong scopes, and pattern-disabled skills", async () => {
		const { cwd, agentDir, settings } = setup();
		const inventory = await getSkillInventory(settings, cwd, agentDir);
		const user = inventory.skills.find((s) => s.name === "user-skill")!;

		settings.setSkillPaths(["!**/nothing"]);
		await settings.flush();
		await expect(
			setSkillEnabled(
				{ skillId: user.id, revision: inventory.revision, scope: "user", enabled: false },
				settings,
				cwd,
				agentDir,
			),
		).rejects.toThrow(/refresh and retry/);

		const fresh = await getSkillInventory(settings, cwd, agentDir);
		await expect(
			setSkillEnabled(
				{ skillId: user.id, revision: fresh.revision, scope: "project", enabled: false },
				settings,
				cwd,
				agentDir,
			),
		).rejects.toThrow(/not found/);

		settings.setSkillPaths(["!skills/user-skill"]);
		await settings.flush();
		const patterned = await getSkillInventory(settings, cwd, agentDir);
		expect(patterned.skills.find((s) => s.name === "user-skill")?.enabled).toBe(false);
		await expect(
			setSkillEnabled(
				{ skillId: user.id, revision: patterned.revision, scope: "user", enabled: true },
				settings,
				cwd,
				agentDir,
			),
		).rejects.toThrow(/pattern/);
	});
});
