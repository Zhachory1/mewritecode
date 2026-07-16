import { Markdown, Spacer } from "@zhachory1/mewrite-tui";
import {
	type SkillAction,
	type SkillCategory,
	type SkillEntry,
	type SkillSourceTag,
	SkillsHubComponent,
} from "../components/skills-hub.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

function mapSkillScope(scope: string): SkillSourceTag {
	if (scope === "user") return "user";
	if (scope === "project") return "project";
	return "bundled";
}

function buildSkillCategories(context: InteractiveSlashCommandContext): SkillCategory[] {
	const skills = context.session.resourceLoader.getSkills().skills;
	const buckets: Record<SkillSourceTag, SkillEntry[]> = {
		bundled: [],
		user: [],
		project: [],
		marketplace: [],
	};
	for (const skill of skills) {
		const tag = mapSkillScope(skill.sourceInfo.scope);
		buckets[tag].push({
			name: skill.name,
			description: skill.description,
			source: tag,
			location: skill.filePath,
		});
	}
	return [
		{ id: "bundled", label: "Bundled", skills: buckets.bundled },
		{ id: "user", label: "User", skills: buckets.user },
		{ id: "project", label: "Project", skills: buckets.project },
		{ id: "marketplace", label: "Marketplace", skills: buckets.marketplace },
	];
}

function handleSkillAction(context: InteractiveSlashCommandContext, action: SkillAction): void {
	if (action.type === "inspect") {
		const skill = action.skill;
		const lines = [
			`### ${skill.name}`,
			"",
			skill.description ? `**Description:** ${skill.description}` : "",
			`**Source:** ${skill.source}`,
			skill.location ? `**Path:** \`${skill.location}\`` : "",
		]
			.filter(Boolean)
			.join("\n");
		context.chatContainer.addChild(new Spacer(1));
		context.chatContainer.addChild(new Markdown(lines, 1, 0, context.getMarkdownTheme()));
		context.ui.requestRender();
		return;
	}
	if (action.skill.source === "marketplace") {
		context.showStatus(`Marketplace install not implemented yet for ${action.skill.name}`);
		return;
	}
	context.showStatus(`${action.skill.name} is already a ${action.skill.source} skill (no install needed)`);
}

export function showSkillsCommand(context: InteractiveSlashCommandContext, initialFilter?: SkillSourceTag): void {
	const categories = buildSkillCategories(context);
	context.showSelector((done) => {
		const component = new SkillsHubComponent({
			categories,
			onAction: (action: SkillAction) => {
				done();
				handleSkillAction(context, action);
			},
			onClose: () => done(),
		});
		void initialFilter;
		return { component, focus: component };
	});
}

export class SkillsCommand extends InteractiveSlashCommand {
	readonly name = "skills";

	condition(text: string): boolean {
		return exact("/skills", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.clearEditor();
		showSkillsCommand(context);
	}
}
