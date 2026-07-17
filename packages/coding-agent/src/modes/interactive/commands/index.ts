import { ActCommand } from "./act-command.js";
import { ActivityCommand } from "./activity-command.js";
import { ApprovalCommand } from "./approval-command.js";
import { ArchitectCommand } from "./architect-command.js";
import { BtwCommand } from "./btw-command.js";
import { CaveCommand } from "./cave-command.js";
import { ChangelogCommand } from "./changelog-command.js";
import { CheckpointCommand } from "./checkpoint-command.js";
import { CheckpointsCommand } from "./checkpoints-command.js";
import { ClearCommand } from "./clear-command.js";
import { CompactCommand } from "./compact-command.js";
import { ContextCommand } from "./context-command.js";
import { ContextLearnCommand } from "./context-learn-command.js";
import { ContextSetupCommand } from "./context-setup-command.js";
import { CopyCommand } from "./copy-command.js";
import { CostCommand } from "./cost-command.js";
import { DebugCommand } from "./debug-command.js";
import { ExportCommand } from "./export-command.js";
import { ForkCommand } from "./fork-command.js";
import { FreezeCommand } from "./freeze-command.js";
import { GoalCommand } from "./goal-command.js";
import { HelpCommand } from "./help-command.js";
import { HooksCommand } from "./hooks-command.js";
import { HotkeysCommand } from "./hotkeys-command.js";
import { ImportCommand } from "./import-command.js";
import type { InteractiveSlashCommand } from "./interactive-slash-command.js";
import { LoginCommand } from "./login-command.js";
import { LogoutCommand } from "./logout-command.js";
import { McpCommand } from "./mcp-command.js";
import { MemoryCommand } from "./memory-command.js";
import { ModeCommand } from "./mode-command.js";
import { ModelCommand } from "./model-command.js";
import { NameCommand } from "./name-command.js";
import { NewCommand } from "./new-command.js";
import { PlanCommand } from "./plan-command.js";
import { PluginsCommand } from "./plugins-command.js";
import { PonytailCommand } from "./ponytail-command.js";
import { QueueCommand } from "./queue-command.js";
import { QuitCommand } from "./quit-command.js";
import { RecipeCommand } from "./recipe-command.js";
import { ReloadCommand } from "./reload-command.js";
import { RepomapCommand } from "./repomap-command.js";
import { ResumeCommand } from "./resume-command.js";
import { RollbackCommand } from "./rollback-command.js";
import { SavingsCommand } from "./savings-command.js";
import { ScopedModelsCommand } from "./scoped-models-command.js";
import { SessionCommand } from "./session-command.js";
import { SettingsCommand } from "./settings-command.js";
import { ShareCommand } from "./share-command.js";
import { SkillsCommand } from "./skills-command.js";
import { TokensCommand } from "./tokens-command.js";
import { TreeCommand } from "./tree-command.js";
import { ZhachSaysHiCommand } from "./zhachsayshi-command.js";

export { type InteractiveSlashCommandContext, InteractiveSlashCommandRouter } from "./interactive-slash-command.js";

export function createDefaultInteractiveSlashCommands(): InteractiveSlashCommand[] {
	return [
		new HelpCommand(),
		new SettingsCommand(),
		new ModelCommand(),
		new ScopedModelsCommand(),
		new ExportCommand(),
		new ImportCommand(),
		new ShareCommand(),
		new CopyCommand(),
		new NameCommand(),
		new SessionCommand(),
		new ChangelogCommand(),
		new HotkeysCommand(),
		new ActivityCommand(),
		new ForkCommand(),
		new TreeCommand(),
		new LoginCommand(),
		new LogoutCommand(),
		new NewCommand(),
		new ClearCommand(),
		new CompactCommand(),
		new FreezeCommand(),
		new CheckpointsCommand(),
		new ModeCommand(),
		new CaveCommand(),
		new PonytailCommand(),
		new TokensCommand(),
		new CostCommand(),
		new SavingsCommand(),
		new ReloadCommand(),
		new HooksCommand(),
		new DebugCommand(),
		new ZhachSaysHiCommand(),
		new ResumeCommand(),
		new QuitCommand(),
		new McpCommand(),
		new MemoryCommand(),
		new RepomapCommand(),
		new ArchitectCommand(),
		new RecipeCommand(),
		new CheckpointCommand(),
		new RollbackCommand(),
		new GoalCommand(),
		new PlanCommand(),
		new ActCommand(),
		new ApprovalCommand(),
		new SkillsCommand(),
		new PluginsCommand(),
		new QueueCommand(),
		new BtwCommand(),
		new ContextCommand(),
		new ContextLearnCommand(),
		new ContextSetupCommand(),
	];
}
